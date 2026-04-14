from __future__ import annotations

import json
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_dataset, get_dataset_image, get_image
from app.api.serializers import serialize_dataset, serialize_editor_state, serialize_health, serialize_image
from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.models.entities import (
    ArchiveFormat,
    Dataset,
    EditAction,
    EditActionKind,
    ExportFormat,
    ExportMode,
    ExportRequest,
    ImageTask,
    ProcessingState,
    SourceType,
    WorkflowLabel,
)
from app.schemas.api import (
    CommitPreviewRequest,
    DatasetResponse,
    EditorStateResponse,
    ExportDatasetRequest,
    ExportImageRequest,
    HealthResponse,
    PreviewRequest,
    PreviewResponse,
    UploadManifestEntry,
    UploadResponseImage,
    WorkflowLabelUpdate,
)
from app.services.exporter import export_service
from app.services.history import history_service
from app.services.queue import InferenceQueue
from app.services.storage import ARCHIVE_EXTENSIONS, IMAGE_EXTENSIONS, storage_service

router = APIRouter()


def _queue(request: Request) -> InferenceQueue:
    return request.app.state.inference_queue


def _backend_ready(request: Request) -> bool:
    return getattr(_queue(request).backend, "ready", True)


def _backend_message(request: Request) -> str:
    return getattr(_queue(request).backend, "message", None) or "The model backend is not ready."


def _serialize_dataset_response(request: Request, dataset) -> DatasetResponse:
    return serialize_dataset(dataset, backend_ready=_backend_ready(request))


def _is_archive(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(ext) for ext in ARCHIVE_EXTENSIONS)


def _validate_workflow_label(value: str) -> str:
    if value not in {label.value for label in WorkflowLabel}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unsupported workflow label.")
    return value


def _validate_export_mode_and_format(mode: str, export_format: str, archive_format: str | None = None) -> None:
    if export_format not in {item.value for item in ExportFormat}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unsupported export format.")
    if mode not in {item.value for item in ExportMode}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unsupported export mode.")
    if mode == ExportMode.transparent.value and export_format not in {"png", "tiff"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Transparent export is only supported for PNG and TIFF.")
    if archive_format is not None and archive_format not in {item.value for item in ArchiveFormat}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unsupported dataset archive format.")


def _guess_dataset_name(entries: list[UploadManifestEntry], files: list[UploadFile], explicit_name: str | None) -> str:
    if explicit_name:
        return explicit_name.strip() or f"dataset-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
    relative_parts = [Path(entry.relativePath).parts for entry in entries if entry.relativePath]
    if relative_parts and all(len(parts) > 1 for parts in relative_parts):
        roots = {parts[0] for parts in relative_parts}
        if len(roots) == 1:
            return next(iter(roots))
    if len(files) == 1 and files[0].filename:
        name = files[0].filename
        lower = name.lower()
        if _is_archive(lower):
            for suffix in [".tar.gz", ".tgz", ".zip"]:
                if lower.endswith(suffix):
                    return name[: -len(suffix)] or "dataset"
        return Path(name).stem or "dataset"
    return f"dataset-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"


def _parse_manifest(manifest: str | None, files: list[UploadFile]) -> list[UploadManifestEntry]:
    if manifest is None:
        return [
            UploadManifestEntry(index=index, relativePath=file.filename or f"upload-{index}", size=0)
            for index, file in enumerate(files)
        ]
    try:
        raw_entries = json.loads(manifest)
        entries = [UploadManifestEntry.model_validate(item) for item in raw_entries]
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Malformed upload manifest.") from exc
    if len(entries) != len(files):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload manifest does not match the uploaded file count.")
    return sorted(entries, key=lambda item: item.index)


def _remove_empty_parent_dirs(root: Path, start: Path) -> None:
    current = start
    while current != root:
        try:
            current.relative_to(root)
        except ValueError:
            return
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def _delete_image_files(
    dataset_id: str,
    image_id: str,
    relative_path: str,
    original_path: str,
    mask_path: str,
) -> None:
    originals_root = storage_service.dataset_originals_dir(dataset_id)
    source_path = originals_root / Path(relative_path)
    derived_path = Path(original_path)

    for path in {source_path, derived_path, Path(mask_path)}:
        path.unlink(missing_ok=True)

    shutil.rmtree(storage_service.history_dir(image_id), ignore_errors=True)

    for parent in {source_path.parent, derived_path.parent}:
        _remove_empty_parent_dirs(originals_root, parent)


async def _prepare_image_job(queue: InferenceQueue, image_id: str) -> None:
    with SessionLocal() as db:
        image = db.get(ImageTask, image_id)
        if image is None:
            return
        original_path = image.original_path
        preparing = db.execute(
            update(ImageTask)
            .where(ImageTask.id == image_id)
            .values(
                processing_state=ProcessingState.preparing.value,
                last_error=None,
            )
        )
        db.commit()
        if preparing.rowcount == 0:
            return
        try:
            prepared = queue.backend.prepare_image(image_id, original_path)
        except Exception as exc:  # pragma: no cover - defensive path
            db.execute(
                update(ImageTask)
                .where(ImageTask.id == image_id)
                .values(
                    processing_state=ProcessingState.failed.value,
                    last_error=str(exc),
                )
            )
            db.commit()
            return
        db.execute(
            update(ImageTask)
            .where(ImageTask.id == image_id)
            .values(
                width=prepared.width,
                height=prepared.height,
                processing_state=ProcessingState.ready.value,
                last_error=None,
            )
        )
        db.commit()


@router.get("/api/health", response_model=HealthResponse)
def healthcheck(request: Request) -> HealthResponse:
    return serialize_health(_queue(request).backend)


@router.post("/api/uploads", response_model=DatasetResponse)
async def upload_files(
    request: Request,
    files: Annotated[list[UploadFile], File(...)],
    manifest: Annotated[str | None, Form()] = None,
    dataset_name: Annotated[str | None, Form()] = None,
    dataset_id: Annotated[str | None, Form()] = None,
    db: Session = Depends(get_db),
) -> DatasetResponse:
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No files were uploaded.")

    entries = _parse_manifest(manifest, files)
    creating_dataset = dataset_id is None
    if creating_dataset:
        dataset_id = str(uuid4())
        dataset_originals_dir = storage_service.dataset_originals_dir(dataset_id)
        dataset_originals_dir.mkdir(parents=True, exist_ok=True)
        dataset = Dataset(
            id=dataset_id,
            name=_guess_dataset_name(entries, files, dataset_name),
            source_type=SourceType.archive.value if all(_is_archive(file.filename or "") for file in files) else SourceType.upload.value,
            root_path=str(dataset_originals_dir),
        )
        db.add(dataset)
        used_paths: set[str] = set()
    else:
        dataset = get_dataset(db, dataset_id)
        dataset_originals_dir = Path(dataset.root_path)
        dataset_originals_dir.mkdir(parents=True, exist_ok=True)
        used_paths = {image.relative_path for image in dataset.images}

    created_images: list[ImageTask] = []
    archive_detected = False

    try:
        for entry, upload in zip(entries, files, strict=True):
            filename = upload.filename or entry.relativePath
            lower_name = filename.lower()
            if _is_archive(lower_name):
                archive_detected = True
                archive_path = storage_service.archive_path(dataset.id, Path(filename).name)
                archive_path.parent.mkdir(parents=True, exist_ok=True)
                storage_service.save_upload_file(upload, archive_path)
                staging_root = Path(
                    tempfile.mkdtemp(prefix="extract-", dir=str(storage_service.archives_dir / dataset.id))
                )
                try:
                    extracted = storage_service.extract_archive(archive_path, staging_root)
                    for relative_path, staged_path in extracted:
                        normalized = storage_service.sanitize_relative_path(relative_path)
                        if normalized in used_paths:
                            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Duplicate file path detected: {normalized}")
                        destination = dataset_originals_dir / normalized
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(staged_path), str(destination))
                        working_path, width, height = storage_service.prepare_ingested_image(destination)
                        image_id = str(uuid4())
                        history_path = storage_service.write_blank_history(image_id)
                        image = ImageTask(
                            id=image_id,
                            dataset_id=dataset.id,
                            relative_path=normalized,
                            original_path=str(working_path),
                            width=width,
                            height=height,
                            history_path=str(history_path),
                            mask_path=str(storage_service.mask_path(image_id)),
                            processing_state=ProcessingState.pending.value,
                        )
                        created_images.append(image)
                        used_paths.add(normalized)
                finally:
                    shutil.rmtree(staging_root, ignore_errors=True)
            else:
                suffix = Path(filename).suffix.lower()
                if suffix not in IMAGE_EXTENSIONS:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsupported upload type: {filename}")
                relative_path = storage_service.sanitize_relative_path(entry.relativePath or filename)
                if relative_path in used_paths:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Duplicate file path detected: {relative_path}")
                destination = dataset_originals_dir / relative_path
                storage_service.save_upload_file(upload, destination)
                working_path, width, height = storage_service.prepare_ingested_image(destination)
                image_id = str(uuid4())
                history_path = storage_service.write_blank_history(image_id)
                image = ImageTask(
                    id=image_id,
                    dataset_id=dataset.id,
                    relative_path=relative_path,
                    original_path=str(working_path),
                    width=width,
                    height=height,
                    history_path=str(history_path),
                    mask_path=str(storage_service.mask_path(image_id)),
                    processing_state=ProcessingState.pending.value,
                )
                created_images.append(image)
                used_paths.add(relative_path)
    except Exception:
        db.rollback()
        for image in created_images:
            _delete_image_files(
                dataset_id=image.dataset_id,
                image_id=image.id,
                relative_path=image.relative_path,
                original_path=image.original_path,
                mask_path=image.mask_path,
            )
        if creating_dataset:
            shutil.rmtree(storage_service.dataset_root(dataset.id), ignore_errors=True)
        raise

    if not created_images:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No supported images were found in the upload.")

    dataset.item_count = dataset.item_count + len(created_images) if not creating_dataset else len(created_images)
    if not creating_dataset or (archive_detected and dataset.source_type != SourceType.archive.value):
        dataset.source_type = SourceType.upload.value

    db.add_all(created_images)
    db.commit()

    if len(created_images) == 1:
        image = created_images[0]
        queue = _queue(request)
        await queue.submit(settings.prepare_priority, lambda image_id=image.id: _prepare_image_job(queue, image_id))
        db.expire_all()

    dataset = get_dataset(db, dataset.id)
    return _serialize_dataset_response(request, dataset)


@router.get("/api/datasets/{dataset_id}", response_model=DatasetResponse)
def dataset_detail(dataset_id: str, request: Request, db: Session = Depends(get_db)) -> DatasetResponse:
    return _serialize_dataset_response(request, get_dataset(db, dataset_id))


@router.post("/api/datasets/{dataset_id}/start", response_model=DatasetResponse)
async def start_dataset_processing(dataset_id: str, request: Request, db: Session = Depends(get_db)) -> DatasetResponse:
    queue = _queue(request)
    if not getattr(queue.backend, "ready", True):
        raise HTTPException(status.HTTP_409_CONFLICT, _backend_message(request))

    dataset = get_dataset(db, dataset_id)
    for image in dataset.images:
        if image.processing_state in {ProcessingState.pending.value, ProcessingState.failed.value}:
            image.processing_state = ProcessingState.queued.value
            image.last_error = None
            db.commit()
            queue.submit_background(settings.prepare_priority, lambda image_id=image.id: _prepare_image_job(queue, image_id))
    return _serialize_dataset_response(request, get_dataset(db, dataset_id))


@router.patch("/api/images/{image_id}/workflow-label", response_model=UploadResponseImage)
def update_workflow_label(image_id: str, payload: WorkflowLabelUpdate, db: Session = Depends(get_db)) -> UploadResponseImage:
    image = get_image(db, image_id)
    image.workflow_label = _validate_workflow_label(payload.workflowLabel)
    db.commit()
    db.refresh(image)
    return serialize_image(image)


@router.delete("/api/datasets/{dataset_id}/images/{image_id}", response_model=DatasetResponse)
def delete_dataset_image(dataset_id: str, image_id: str, request: Request, db: Session = Depends(get_db)) -> DatasetResponse:
    dataset, image = get_dataset_image(db, dataset_id, image_id)
    cleanup_target = {
        "dataset_id": image.dataset_id,
        "image_id": image.id,
        "relative_path": image.relative_path,
        "original_path": image.original_path,
        "mask_path": image.mask_path,
    }

    queue = _queue(request)
    queue.discard_image(image.id)

    db.execute(delete(EditAction).where(EditAction.image_id == image.id))
    db.execute(
        update(ExportRequest)
        .where(ExportRequest.image_id == image.id)
        .values(image_id=None)
    )
    db.delete(image)
    db.flush()
    dataset.item_count = db.scalar(
        select(func.count())
        .select_from(ImageTask)
        .where(ImageTask.dataset_id == dataset.id)
    ) or 0
    db.commit()

    _delete_image_files(**cleanup_target)

    db.expire_all()
    return _serialize_dataset_response(request, get_dataset(db, dataset.id))


@router.get("/api/images/{image_id}", response_model=EditorStateResponse)
def editor_state(image_id: str, db: Session = Depends(get_db)) -> EditorStateResponse:
    return serialize_editor_state(get_image(db, image_id))


@router.get("/api/images/{image_id}/original")
def download_original(image_id: str, db: Session = Depends(get_db)) -> FileResponse:
    image = get_image(db, image_id)
    filename = f"{Path(image.relative_path).stem}{Path(image.original_path).suffix}"
    return FileResponse(path=image.original_path, media_type="application/octet-stream", filename=filename)


@router.get("/api/images/{image_id}/history")
def download_history(image_id: str, db: Session = Depends(get_db)) -> FileResponse:
    image = get_image(db, image_id)
    if not Path(image.history_path).exists():
        storage_service.write_blank_history(image.id)
    return FileResponse(path=image.history_path, media_type="application/json", filename=f"{Path(image.relative_path).stem}-history.json")


@router.post("/api/images/{image_id}/preview", response_model=PreviewResponse)
async def preview_image(image_id: str, payload: PreviewRequest, request: Request, db: Session = Depends(get_db)) -> PreviewResponse:
    queue = _queue(request)
    if not getattr(queue.backend, "ready", True):
        raise HTTPException(status.HTTP_409_CONFLICT, _backend_message(request))

    image = get_image(db, image_id)
    if image.processing_state != ProcessingState.ready.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "Image is not ready for interactive editing yet.")
    mask = await queue.submit_preview(
        image.id,
        settings.preview_priority,
        lambda: queue.backend.preview_mask(image.id, image.original_path, payload.x, payload.y),
    )
    preview_id = queue.store_preview(image, mask, {"x": payload.x, "y": payload.y})
    return PreviewResponse(
        previewId=preview_id,
        requestId=payload.requestId,
        maskPngBase64=storage_service.mask_to_base64(mask),
        prompt={"x": payload.x, "y": payload.y},
    )


def _commit_preview(image_id: str, payload: CommitPreviewRequest, kind: EditActionKind, request: Request, db: Session) -> EditorStateResponse:
    image = get_image(db, image_id)
    queue = _queue(request)
    preview = queue.consume_preview(image_id, payload.previewId)
    if preview is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The preview is no longer available. Request a new preview and try again.")
    state = history_service.apply_preview(db, image, preview.mask, kind=kind, prompt=payload.prompt)
    db.commit()
    db.refresh(image)
    response = serialize_editor_state(image)
    response.committedMaskPngBase64 = storage_service.mask_to_base64(state.mask) if state.mask.any() else None
    response.canUndo = state.can_undo
    response.canRedo = state.can_redo
    response.historyDepth = state.history_depth
    return response


@router.post("/api/images/{image_id}/mask", response_model=EditorStateResponse)
def apply_mask(image_id: str, payload: CommitPreviewRequest, request: Request, db: Session = Depends(get_db)) -> EditorStateResponse:
    return _commit_preview(image_id, payload, EditActionKind.mask, request, db)


@router.post("/api/images/{image_id}/unmask", response_model=EditorStateResponse)
def remove_mask(image_id: str, payload: CommitPreviewRequest, request: Request, db: Session = Depends(get_db)) -> EditorStateResponse:
    return _commit_preview(image_id, payload, EditActionKind.unmask, request, db)


@router.post("/api/images/{image_id}/undo", response_model=EditorStateResponse)
def undo(image_id: str, db: Session = Depends(get_db)) -> EditorStateResponse:
    image = get_image(db, image_id)
    state = history_service.undo(db, image)
    db.commit()
    db.refresh(image)
    response = serialize_editor_state(image)
    response.committedMaskPngBase64 = storage_service.mask_to_base64(state.mask) if state.mask.any() else None
    response.canUndo = state.can_undo
    response.canRedo = state.can_redo
    response.historyDepth = state.history_depth
    return response


@router.post("/api/images/{image_id}/redo", response_model=EditorStateResponse)
def redo(image_id: str, db: Session = Depends(get_db)) -> EditorStateResponse:
    image = get_image(db, image_id)
    state = history_service.redo(db, image)
    db.commit()
    db.refresh(image)
    response = serialize_editor_state(image)
    response.committedMaskPngBase64 = storage_service.mask_to_base64(state.mask) if state.mask.any() else None
    response.canUndo = state.can_undo
    response.canRedo = state.can_redo
    response.historyDepth = state.history_depth
    return response


@router.post("/api/images/{image_id}/restore", response_model=EditorStateResponse)
def restore(image_id: str, db: Session = Depends(get_db)) -> EditorStateResponse:
    image = get_image(db, image_id)
    state = history_service.restore(db, image)
    db.commit()
    db.refresh(image)
    response = serialize_editor_state(image)
    response.committedMaskPngBase64 = None
    response.canUndo = state.can_undo
    response.canRedo = state.can_redo
    response.historyDepth = state.history_depth
    return response


@router.post("/api/exports/image/{image_id}")
def export_image(image_id: str, payload: ExportImageRequest, db: Session = Depends(get_db)) -> FileResponse:
    _validate_export_mode_and_format(payload.mode, payload.format)
    image = get_image(db, image_id)
    output_path = export_service.export_image(db, image, payload.format, payload.mode)
    db.commit()
    filename = f"{Path(image.relative_path).stem}.{payload.format}"
    return FileResponse(path=output_path, media_type="application/octet-stream", filename=filename)


@router.post("/api/exports/dataset/{dataset_id}")
def export_dataset(dataset_id: str, payload: ExportDatasetRequest, db: Session = Depends(get_db)) -> FileResponse:
    _validate_export_mode_and_format(payload.mode, payload.format, payload.archiveFormat)
    dataset = get_dataset(db, dataset_id)
    if not dataset.images:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dataset has no images to export.")
    output_path = export_service.export_dataset(db, list(dataset.images), payload.format, payload.mode, payload.archiveFormat)
    db.commit()
    filename = f"{dataset.name}.{'zip' if payload.archiveFormat == 'zip' else 'tar.gz'}"
    return FileResponse(path=output_path, media_type="application/octet-stream", filename=filename)
