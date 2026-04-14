from __future__ import annotations

from app.models.entities import Dataset, ImageTask
from app.schemas.api import (
    DatasetActionsResponse,
    DatasetResponse,
    DatasetSummaryResponse,
    EditorStateResponse,
    HealthResponse,
    ImageActionsResponse,
    LabelCountsResponse,
    ProcessingCountsResponse,
    UploadResponseImage,
)
from app.services.history import history_service
from app.services.storage import storage_service
from app.services.workflow import dataset_actions, has_in_flight_work, image_actions, label_counts, processing_counts


def serialize_health(backend) -> HealthResponse:
    ready = getattr(backend, "ready", True)
    message = getattr(backend, "message", None)
    return HealthResponse(
        status="ok",
        backend=backend.name,
        device=getattr(backend, "device", "n/a"),
        ready=ready,
        message=message,
    )


def serialize_image(image: ImageTask) -> UploadResponseImage:
    return UploadResponseImage(
        id=image.id,
        datasetId=image.dataset_id,
        relativePath=image.relative_path,
        width=image.width,
        height=image.height,
        workflowLabel=image.workflow_label,
        processingState=image.processing_state,
        hasSavedMask=image.has_saved_mask,
        historyDepth=image.history_depth,
        lastError=image.last_error,
        originalUrl=f"/api/images/{image.id}/original",
        historyUrl=f"/api/images/{image.id}/history",
        actions=ImageActionsResponse(**image_actions(image)),
    )


def serialize_dataset(dataset: Dataset, *, backend_ready: bool) -> DatasetResponse:
    images = list(dataset.images)
    return DatasetResponse(
        id=dataset.id,
        name=dataset.name,
        sourceType=dataset.source_type,
        rootPath=dataset.root_path,
        itemCount=dataset.item_count,
        createdAt=dataset.created_at,
        summary=DatasetSummaryResponse(
            processingCounts=ProcessingCountsResponse(**processing_counts(images)),
            labelCounts=LabelCountsResponse(**label_counts(images)),
            hasInFlightWork=has_in_flight_work(images),
        ),
        actions=DatasetActionsResponse(**dataset_actions(images, backend_ready=backend_ready)),
        images=[serialize_image(image) for image in images],
    )


def serialize_editor_state(image: ImageTask) -> EditorStateResponse:
    history = history_service.load_history(image)
    mask = history_service.load_committed_mask(image)
    committed_mask = storage_service.mask_to_base64(mask) if image.has_saved_mask else None
    return EditorStateResponse(
        id=image.id,
        datasetId=image.dataset_id,
        relativePath=image.relative_path,
        width=image.width or 0,
        height=image.height or 0,
        workflowLabel=image.workflow_label,
        processingState=image.processing_state,
        hasSavedMask=image.has_saved_mask,
        historyDepth=image.history_depth,
        canUndo=history["cursor"] >= 0,
        canRedo=history["cursor"] < len(history["actions"]) - 1,
        originalUrl=f"/api/images/{image.id}/original",
        historyUrl=f"/api/images/{image.id}/history",
        committedMaskPngBase64=committed_mask,
    )
