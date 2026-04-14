from __future__ import annotations

import io
import json
import os
import shutil
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select


TEST_ROOT = Path(__file__).resolve().parents[3] / ".test-runtime"
os.environ["AUTOMASK_STORAGE_ROOT"] = str(TEST_ROOT / "storage")
os.environ["AUTOMASK_DATABASE_PATH"] = str(TEST_ROOT / "storage" / "automask.db")
os.environ["AUTOMASK_MODEL_BACKEND"] = "mock"

from app.core.database import Base, SessionLocal, engine
from app.main import app
from app.models.entities import ExportRequest, ImageTask, ProcessingState, WorkflowLabel


def make_image_bytes(color: tuple[int, int, int] = (120, 200, 240), size: tuple[int, int] = (48, 48)) -> bytes:
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def clean_runtime() -> None:
    engine.dispose()
    if TEST_ROOT.exists():
        shutil.rmtree(TEST_ROOT)
    TEST_ROOT.mkdir(parents=True, exist_ok=True)
    (TEST_ROOT / "storage").mkdir(parents=True, exist_ok=True)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    engine.dispose()
    if TEST_ROOT.exists():
        shutil.rmtree(TEST_ROOT)


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def wait_for_ready(client: TestClient, dataset_id: str, *, timeout: float = 3.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        response = client.get(f"/api/datasets/{dataset_id}")
        response.raise_for_status()
        payload = response.json()
        if all(item["processingState"] == "ready" for item in payload["images"]):
            return payload
        time.sleep(0.05)
    raise AssertionError("Timed out waiting for dataset preparation.")


def assert_dataset_contract(
    payload: dict,
    *,
    processing_counts: dict[str, int],
    label_counts: dict[str, int],
    has_in_flight_work: bool,
    can_start_processing: bool,
    can_export_dataset: bool,
    recommended_primary_action: str,
) -> None:
    assert payload["summary"]["processingCounts"] == processing_counts
    assert payload["summary"]["labelCounts"] == label_counts
    assert payload["summary"]["hasInFlightWork"] is has_in_flight_work
    assert payload["actions"] == {
        "canStartProcessing": can_start_processing,
        "canExportDataset": can_export_dataset,
        "recommendedPrimaryAction": recommended_primary_action,
    }


def test_single_image_upload_prepares_for_editing(client: TestClient) -> None:
    manifest = json.dumps([{"index": 0, "relativePath": "sample.png", "size": 0}])
    response = client.post(
        "/api/uploads",
        data={"manifest": manifest, "dataset_name": "single-sample"},
        files=[("files", ("sample.png", make_image_bytes(), "image/png"))],
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "single-sample"
    assert payload["itemCount"] == 1
    assert payload["images"][0]["processingState"] == "ready"
    assert payload["images"][0]["actions"] == {"canOpenEditor": True, "canRemove": True}
    assert_dataset_contract(
        payload,
        processing_counts={"pending": 0, "queued": 0, "preparing": 0, "ready": 1, "failed": 0},
        label_counts={"todo": 1, "in_progress": 0, "completed": 0},
        has_in_flight_work=False,
        can_start_processing=False,
        can_export_dataset=True,
        recommended_primary_action="review_ready",
    )


def test_upload_can_append_into_existing_dataset_task_list(client: TestClient) -> None:
    initial = client.post(
        "/api/uploads",
        data={
          "manifest": json.dumps([{"index": 0, "relativePath": "initial.png", "size": 0}]),
          "dataset_name": "append-target",
        },
        files=[("files", ("initial.png", make_image_bytes(), "image/png"))],
    )
    assert initial.status_code == 200
    initial_payload = initial.json()
    dataset_id = initial_payload["id"]

    appended = client.post(
        "/api/uploads",
        data={
            "manifest": json.dumps([{"index": 0, "relativePath": "nested/new.png", "size": 0}]),
            "dataset_id": dataset_id,
            "dataset_name": "ignored-new-name",
        },
        files=[("files", ("new.png", make_image_bytes((220, 120, 50)), "image/png"))],
    )
    assert appended.status_code == 200
    payload = appended.json()

    assert payload["id"] == dataset_id
    assert payload["name"] == "append-target"
    assert payload["itemCount"] == 2
    assert [image["relativePath"] for image in payload["images"]] == ["initial.png", "nested/new.png"]
    assert all(image["processingState"] == "ready" for image in payload["images"])
    assert_dataset_contract(
        payload,
        processing_counts={"pending": 0, "queued": 0, "preparing": 0, "ready": 2, "failed": 0},
        label_counts={"todo": 2, "in_progress": 0, "completed": 0},
        has_in_flight_work=False,
        can_start_processing=False,
        can_export_dataset=True,
        recommended_primary_action="review_ready",
    )


def test_appended_upload_rejects_duplicate_relative_paths(client: TestClient) -> None:
    initial = client.post(
        "/api/uploads",
        data={"manifest": json.dumps([{"index": 0, "relativePath": "duplicate.png", "size": 0}])},
        files=[("files", ("duplicate.png", make_image_bytes(), "image/png"))],
    )
    assert initial.status_code == 200
    dataset_id = initial.json()["id"]

    duplicate = client.post(
        "/api/uploads",
        data={
            "manifest": json.dumps([{"index": 0, "relativePath": "duplicate.png", "size": 0}]),
            "dataset_id": dataset_id,
        },
        files=[("files", ("duplicate.png", make_image_bytes((30, 60, 90)), "image/png"))],
    )
    assert duplicate.status_code == 400
    assert duplicate.json()["detail"] == "Duplicate file path detected: duplicate.png"


def test_health_and_backend_readiness_guards(client: TestClient) -> None:
    ready_health = client.get("/api/health")
    assert ready_health.status_code == 200
    assert ready_health.json() == {
        "status": "ok",
        "backend": "mock",
        "device": "cpu",
        "ready": True,
        "message": None,
    }

    ready_upload = client.post(
        "/api/uploads",
        data={"manifest": json.dumps([{"index": 0, "relativePath": "ready.png", "size": 0}])},
        files=[("files", ("ready.png", make_image_bytes(), "image/png"))],
    )
    assert ready_upload.status_code == 200
    ready_image_id = ready_upload.json()["images"][0]["id"]

    pending_upload = client.post(
        "/api/uploads",
        data={
            "manifest": json.dumps(
                [
                    {"index": 0, "relativePath": "batch/a.png", "size": 0},
                    {"index": 1, "relativePath": "batch/b.png", "size": 0},
                ]
            )
        },
        files=[
            ("files", ("a.png", make_image_bytes((50, 120, 220)), "image/png")),
            ("files", ("b.png", make_image_bytes((220, 120, 50)), "image/png")),
        ],
    )
    assert pending_upload.status_code == 200
    pending_dataset_id = pending_upload.json()["id"]

    client.app.state.inference_queue.backend = SimpleNamespace(
        name="sam3",
        device="cuda",
        ready=False,
        message="Install a CUDA-enabled PyTorch build to enable SAM3.",
    )

    blocked_health = client.get("/api/health")
    assert blocked_health.status_code == 200
    assert blocked_health.json() == {
        "status": "ok",
        "backend": "sam3",
        "device": "cuda",
        "ready": False,
        "message": "Install a CUDA-enabled PyTorch build to enable SAM3.",
    }

    preview = client.post(
        f"/api/images/{ready_image_id}/preview",
        json={"x": 12, "y": 12, "requestId": "preview-readiness"},
    )
    assert preview.status_code == 409
    assert preview.json()["detail"] == "Install a CUDA-enabled PyTorch build to enable SAM3."

    start = client.post(f"/api/datasets/{pending_dataset_id}/start")
    assert start.status_code == 409
    assert start.json()["detail"] == "Install a CUDA-enabled PyTorch build to enable SAM3."


def test_preview_commit_undo_redo_restore_flow(client: TestClient) -> None:
    manifest = json.dumps([{"index": 0, "relativePath": "editable.png", "size": 0}])
    upload = client.post(
        "/api/uploads",
        data={"manifest": manifest},
        files=[("files", ("editable.png", make_image_bytes(), "image/png"))],
    )
    image_id = upload.json()["images"][0]["id"]

    preview = client.post(
        f"/api/images/{image_id}/preview",
        json={"x": 12, "y": 12, "requestId": "preview-1"},
    )
    assert preview.status_code == 200
    preview_payload = preview.json()
    assert preview_payload["previewId"]

    mask_commit = client.post(
        f"/api/images/{image_id}/mask",
        json={
            "previewId": preview_payload["previewId"],
            "prompt": preview_payload["prompt"],
        },
    )
    assert mask_commit.status_code == 200
    masked_state = mask_commit.json()
    assert masked_state["historyDepth"] == 1
    assert masked_state["hasSavedMask"] is True
    assert masked_state["canUndo"] is True

    undo = client.post(f"/api/images/{image_id}/undo")
    assert undo.status_code == 200
    undo_state = undo.json()
    assert undo_state["hasSavedMask"] is False
    assert undo_state["canRedo"] is True

    redo = client.post(f"/api/images/{image_id}/redo")
    assert redo.status_code == 200
    redo_state = redo.json()
    assert redo_state["hasSavedMask"] is True

    restore = client.post(f"/api/images/{image_id}/restore")
    assert restore.status_code == 200
    restore_state = restore.json()
    assert restore_state["historyDepth"] == 0
    assert restore_state["hasSavedMask"] is False

    history = client.get(f"/api/images/{image_id}/history")
    assert history.status_code == 200
    history_payload = history.json()
    assert history_payload["cursor"] == -1
    assert history_payload["actions"] == []


def test_zip_upload_and_dataset_export_preserve_structure(client: TestClient) -> None:
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as archive:
        archive.writestr("dataset/a.png", make_image_bytes((200, 50, 50)))
        archive.writestr("dataset/nested/b.png", make_image_bytes((50, 200, 50)))

    manifest = json.dumps([{"index": 0, "relativePath": "dataset.zip", "size": len(zip_buffer.getvalue())}])
    upload = client.post(
        "/api/uploads",
        data={"manifest": manifest},
        files=[("files", ("dataset.zip", zip_buffer.getvalue(), "application/zip"))],
    )
    assert upload.status_code == 200
    dataset_id = upload.json()["id"]

    start = client.post(f"/api/datasets/{dataset_id}/start")
    assert start.status_code == 200
    wait_for_ready(client, dataset_id)

    export = client.post(
        f"/api/exports/dataset/{dataset_id}",
        json={"format": "png", "mode": "overlay", "archiveFormat": "zip"},
    )
    assert export.status_code == 200

    archive = zipfile.ZipFile(io.BytesIO(export.content))
    names = sorted(archive.namelist())
    assert "dataset/a.png" in names
    assert "dataset/nested/b.png" in names


def test_invalid_transparent_jpg_export_is_rejected(client: TestClient) -> None:
    manifest = json.dumps([{"index": 0, "relativePath": "sample.png", "size": 0}])
    upload = client.post(
        "/api/uploads",
        data={"manifest": manifest},
        files=[("files", ("sample.png", make_image_bytes(), "image/png"))],
    )
    image_id = upload.json()["images"][0]["id"]

    response = client.post(
        f"/api/exports/image/{image_id}",
        json={"format": "jpg", "mode": "transparent"},
    )
    assert response.status_code == 422


def test_dataset_summary_and_recommended_actions_cover_pending_inflight_ready_and_complete_states(client: TestClient) -> None:
    manifest = json.dumps(
        [
            {"index": 0, "relativePath": "set/a.png", "size": 0},
            {"index": 1, "relativePath": "set/b.png", "size": 0},
            {"index": 2, "relativePath": "set/c.png", "size": 0},
        ]
    )
    upload = client.post(
        "/api/uploads",
        data={"manifest": manifest},
        files=[
            ("files", ("a.png", make_image_bytes((120, 200, 240)), "image/png")),
            ("files", ("b.png", make_image_bytes((200, 120, 240)), "image/png")),
            ("files", ("c.png", make_image_bytes((240, 200, 120)), "image/png")),
        ],
    )
    assert upload.status_code == 200
    dataset_id = upload.json()["id"]

    initial = client.get(f"/api/datasets/{dataset_id}")
    assert initial.status_code == 200
    initial_payload = initial.json()
    assert_dataset_contract(
        initial_payload,
        processing_counts={"pending": 3, "queued": 0, "preparing": 0, "ready": 0, "failed": 0},
        label_counts={"todo": 3, "in_progress": 0, "completed": 0},
        has_in_flight_work=False,
        can_start_processing=True,
        can_export_dataset=True,
        recommended_primary_action="start_processing",
    )
    assert all(image["actions"] == {"canOpenEditor": False, "canRemove": True} for image in initial_payload["images"])

    with SessionLocal() as db:
        images = db.scalars(
            select(ImageTask)
            .where(ImageTask.dataset_id == dataset_id)
            .order_by(ImageTask.relative_path)
        ).all()
        images[0].processing_state = ProcessingState.ready.value
        images[0].workflow_label = WorkflowLabel.in_progress.value
        images[1].processing_state = ProcessingState.preparing.value
        images[2].processing_state = ProcessingState.failed.value
        db.commit()

    in_flight = client.get(f"/api/datasets/{dataset_id}")
    assert in_flight.status_code == 200
    in_flight_payload = in_flight.json()
    assert_dataset_contract(
        in_flight_payload,
        processing_counts={"pending": 0, "queued": 0, "preparing": 1, "ready": 1, "failed": 1},
        label_counts={"todo": 2, "in_progress": 1, "completed": 0},
        has_in_flight_work=True,
        can_start_processing=False,
        can_export_dataset=True,
        recommended_primary_action="processing",
    )

    with SessionLocal() as db:
        images = db.scalars(
            select(ImageTask)
            .where(ImageTask.dataset_id == dataset_id)
            .order_by(ImageTask.relative_path)
        ).all()
        for image in images:
            image.processing_state = ProcessingState.ready.value
        images[0].workflow_label = WorkflowLabel.todo.value
        images[1].workflow_label = WorkflowLabel.in_progress.value
        images[2].workflow_label = WorkflowLabel.completed.value
        db.commit()

    review_ready = client.get(f"/api/datasets/{dataset_id}")
    assert review_ready.status_code == 200
    review_ready_payload = review_ready.json()
    assert_dataset_contract(
        review_ready_payload,
        processing_counts={"pending": 0, "queued": 0, "preparing": 0, "ready": 3, "failed": 0},
        label_counts={"todo": 1, "in_progress": 1, "completed": 1},
        has_in_flight_work=False,
        can_start_processing=False,
        can_export_dataset=True,
        recommended_primary_action="review_ready",
    )
    assert sum(1 for image in review_ready_payload["images"] if image["actions"]["canOpenEditor"]) == 3

    with SessionLocal() as db:
        images = db.scalars(
            select(ImageTask)
            .where(ImageTask.dataset_id == dataset_id)
            .order_by(ImageTask.relative_path)
        ).all()
        for image in images:
            image.workflow_label = WorkflowLabel.completed.value
        db.commit()

    export_ready = client.get(f"/api/datasets/{dataset_id}")
    assert export_ready.status_code == 200
    assert_dataset_contract(
        export_ready.json(),
        processing_counts={"pending": 0, "queued": 0, "preparing": 0, "ready": 3, "failed": 0},
        label_counts={"todo": 0, "in_progress": 0, "completed": 3},
        has_in_flight_work=False,
        can_start_processing=False,
        can_export_dataset=True,
        recommended_primary_action="export_dataset",
    )


def test_image_can_be_removed_from_dataset_task_list(client: TestClient) -> None:
    manifest = json.dumps([{"index": 0, "relativePath": "editable.png", "size": 0}])
    upload = client.post(
        "/api/uploads",
        data={"manifest": manifest},
        files=[("files", ("editable.png", make_image_bytes(), "image/png"))],
    )
    dataset_id = upload.json()["id"]
    image_id = upload.json()["images"][0]["id"]

    preview = client.post(
        f"/api/images/{image_id}/preview",
        json={"x": 12, "y": 12, "requestId": "preview-delete"},
    )
    assert preview.status_code == 200
    preview_payload = preview.json()

    commit = client.post(
        f"/api/images/{image_id}/mask",
        json={
            "previewId": preview_payload["previewId"],
            "prompt": preview_payload["prompt"],
        },
    )
    assert commit.status_code == 200

    export = client.post(
        f"/api/exports/image/{image_id}",
        json={"format": "png", "mode": "overlay"},
    )
    assert export.status_code == 200

    original_path = TEST_ROOT / "storage" / "datasets" / dataset_id / "originals" / "editable.png"
    history_path = TEST_ROOT / "storage" / "histories" / image_id / "history.json"
    mask_path = TEST_ROOT / "storage" / "masks" / f"{image_id}.png"
    assert original_path.exists()
    assert history_path.exists()
    assert mask_path.exists()

    response = client.delete(f"/api/datasets/{dataset_id}/images/{image_id}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["itemCount"] == 0
    assert payload["images"] == []
    assert_dataset_contract(
        payload,
        processing_counts={"pending": 0, "queued": 0, "preparing": 0, "ready": 0, "failed": 0},
        label_counts={"todo": 0, "in_progress": 0, "completed": 0},
        has_in_flight_work=False,
        can_start_processing=False,
        can_export_dataset=False,
        recommended_primary_action="upload_more",
    )

    assert not original_path.exists()
    assert not history_path.exists()
    assert not mask_path.exists()

    image_state = client.get(f"/api/images/{image_id}")
    assert image_state.status_code == 404

    with SessionLocal() as db:
        export_request = db.scalar(select(ExportRequest).where(ExportRequest.dataset_id == dataset_id))
        assert export_request is not None
        assert export_request.image_id is None
