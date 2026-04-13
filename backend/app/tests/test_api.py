from __future__ import annotations

import io
import json
import os
import shutil
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image


TEST_ROOT = Path(__file__).resolve().parents[3] / ".test-runtime"
os.environ["AUTOMASK_STORAGE_ROOT"] = str(TEST_ROOT / "storage")
os.environ["AUTOMASK_DATABASE_PATH"] = str(TEST_ROOT / "storage" / "automask.db")
os.environ["AUTOMASK_MODEL_BACKEND"] = "mock"

from app.core.database import Base, engine
from app.main import app


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
