from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import numpy as np
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import EditAction, EditActionKind, ImageTask
from app.services.storage import storage_service


@dataclass
class EditorState:
    mask: np.ndarray
    history_depth: int
    can_undo: bool
    can_redo: bool


class HistoryService:
    def load_history(self, image: ImageTask) -> dict:
        history_path = Path(image.history_path)
        if not history_path.exists():
            storage_service.write_blank_history(image.id)
        return json.loads(history_path.read_text(encoding="utf-8"))

    def load_committed_mask(self, image: ImageTask) -> np.ndarray:
        width = image.width or 1
        height = image.height or 1
        return storage_service.load_mask(image.mask_path, width=width, height=height)

    def _save_history(self, image: ImageTask, history: dict) -> None:
        Path(image.history_path).write_text(json.dumps(history, indent=2), encoding="utf-8")

    def _save_current_mask(self, image: ImageTask, mask: np.ndarray) -> None:
        if mask.any():
            storage_service.save_mask(mask, image.mask_path)
            image.has_saved_mask = True
        else:
            storage_service.remove_mask(image.mask_path)
            image.has_saved_mask = False

    def _sync_edit_actions(self, db: Session, image: ImageTask, history: dict) -> None:
        db.execute(delete(EditAction).where(EditAction.image_id == image.id))
        for index, item in enumerate(history["actions"]):
            db.add(
                EditAction(
                    id=item["id"],
                    image_id=image.id,
                    kind=item["kind"],
                    prompt=item["prompt"],
                    mask_digest=item["maskDigest"],
                    sequence_number=index,
                    snapshot_path=item["snapshotPath"],
                    created_at=datetime.fromisoformat(item["createdAt"]),
                )
            )

    def _snapshot_path(self, image_id: str, action_id: str, sequence_number: int) -> Path:
        snapshots_dir = storage_service.history_snapshots_dir(image_id)
        snapshots_dir.mkdir(parents=True, exist_ok=True)
        return snapshots_dir / f"{sequence_number:04d}_{action_id}.png"

    def _truncate_future_snapshots(self, history: dict) -> None:
        cursor = history["cursor"]
        while len(history["actions"]) - 1 > cursor:
            item = history["actions"].pop()
            Path(item["snapshotPath"]).unlink(missing_ok=True)

    def _drop_oldest_snapshot(self, history: dict) -> None:
        item = history["actions"].pop(0)
        Path(item["snapshotPath"]).unlink(missing_ok=True)
        history["cursor"] -= 1

    def _editor_state(self, image: ImageTask, history: dict, mask: np.ndarray) -> EditorState:
        image.history_depth = len(history["actions"])
        image.history_cursor = history["cursor"]
        return EditorState(
            mask=mask,
            history_depth=image.history_depth,
            can_undo=history["cursor"] >= 0,
            can_redo=history["cursor"] < len(history["actions"]) - 1,
        )

    def apply_preview(
        self,
        db: Session,
        image: ImageTask,
        preview_mask: np.ndarray,
        kind: EditActionKind,
        prompt: dict,
    ) -> EditorState:
        history = self.load_history(image)
        current_mask = self.load_committed_mask(image)
        if history["cursor"] < len(history["actions"]) - 1:
            self._truncate_future_snapshots(history)

        if kind == EditActionKind.mask:
            next_mask = np.maximum(current_mask, preview_mask)
        else:
            next_mask = np.where(preview_mask > 0, 0, current_mask).astype(np.uint8)

        action_id = str(uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        sequence_number = len(history["actions"])
        snapshot_path = self._snapshot_path(image.id, action_id, sequence_number)
        storage_service.save_mask(next_mask, snapshot_path)
        history["actions"].append(
            {
                "id": action_id,
                "kind": kind.value,
                "prompt": prompt,
                "maskDigest": storage_service.digest_mask(next_mask),
                "createdAt": created_at,
                "snapshotPath": str(snapshot_path),
            }
        )
        history["cursor"] = len(history["actions"]) - 1
        while len(history["actions"]) > settings.history_depth:
            self._drop_oldest_snapshot(history)

        self._save_current_mask(image, next_mask)
        self._save_history(image, history)
        self._sync_edit_actions(db, image, history)
        return self._editor_state(image, history, next_mask)

    def undo(self, db: Session, image: ImageTask) -> EditorState:
        history = self.load_history(image)
        if history["cursor"] < 0:
            return self._editor_state(image, history, self.load_committed_mask(image))
        history["cursor"] -= 1
        if history["cursor"] >= 0:
            snapshot_path = history["actions"][history["cursor"]]["snapshotPath"]
            mask = storage_service.load_mask(snapshot_path, image.width or 1, image.height or 1)
        else:
            mask = np.zeros((image.height or 1, image.width or 1), dtype=np.uint8)
        self._save_current_mask(image, mask)
        self._save_history(image, history)
        self._sync_edit_actions(db, image, history)
        return self._editor_state(image, history, mask)

    def redo(self, db: Session, image: ImageTask) -> EditorState:
        history = self.load_history(image)
        if history["cursor"] >= len(history["actions"]) - 1:
            return self._editor_state(image, history, self.load_committed_mask(image))
        history["cursor"] += 1
        snapshot_path = history["actions"][history["cursor"]]["snapshotPath"]
        mask = storage_service.load_mask(snapshot_path, image.width or 1, image.height or 1)
        self._save_current_mask(image, mask)
        self._save_history(image, history)
        self._sync_edit_actions(db, image, history)
        return self._editor_state(image, history, mask)

    def restore(self, db: Session, image: ImageTask) -> EditorState:
        history = self.load_history(image)
        for item in history["actions"]:
            Path(item["snapshotPath"]).unlink(missing_ok=True)
        history["actions"] = []
        history["cursor"] = -1
        mask = np.zeros((image.height or 1, image.width or 1), dtype=np.uint8)
        self._save_current_mask(image, mask)
        self._save_history(image, history)
        self._sync_edit_actions(db, image, history)
        return self._editor_state(image, history, mask)


history_service = HistoryService()
