from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SourceType(StrEnum):
    upload = "upload"
    archive = "archive"


class WorkflowLabel(StrEnum):
    todo = "todo"
    in_progress = "in_progress"
    completed = "completed"


class ProcessingState(StrEnum):
    pending = "pending"
    queued = "queued"
    preparing = "preparing"
    ready = "ready"
    failed = "failed"


class EditActionKind(StrEnum):
    mask = "mask"
    unmask = "unmask"


class ExportMode(StrEnum):
    transparent = "transparent"
    binary_mask = "binary_mask"
    overlay = "overlay"


class ExportFormat(StrEnum):
    png = "png"
    jpg = "jpg"
    bmp = "bmp"
    tiff = "tiff"


class ArchiveFormat(StrEnum):
    zip = "zip"
    tar_gz = "tar.gz"


class ExportStatus(StrEnum):
    completed = "completed"
    failed = "failed"


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    root_path: Mapped[str] = mapped_column(Text, nullable=False)
    item_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    images: Mapped[list["ImageTask"]] = relationship(
        back_populates="dataset",
        cascade="all, delete-orphan",
        order_by="ImageTask.relative_path",
    )


class ImageTask(Base):
    __tablename__ = "image_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    relative_path: Mapped[str] = mapped_column(Text, nullable=False)
    original_path: Mapped[str] = mapped_column(Text, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    workflow_label: Mapped[str] = mapped_column(String(32), default=WorkflowLabel.todo.value, nullable=False)
    processing_state: Mapped[str] = mapped_column(String(32), default=ProcessingState.pending.value, nullable=False)
    has_saved_mask: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    history_depth: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    history_cursor: Mapped[int] = mapped_column(Integer, default=-1, nullable=False)
    history_path: Mapped[str] = mapped_column(Text, nullable=False)
    mask_path: Mapped[str] = mapped_column(Text, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )

    dataset: Mapped[Dataset] = relationship(back_populates="images")
    edit_actions: Mapped[list["EditAction"]] = relationship(
        back_populates="image",
        cascade="all, delete-orphan",
        order_by="EditAction.sequence_number",
    )


class EditAction(Base):
    __tablename__ = "edit_actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    image_id: Mapped[str] = mapped_column(ForeignKey("image_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    prompt: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    mask_digest: Mapped[str] = mapped_column(String(128), nullable=False)
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    image: Mapped[ImageTask] = relationship(back_populates="edit_actions")


class ExportRequest(Base):
    __tablename__ = "export_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    image_id: Mapped[str | None] = mapped_column(ForeignKey("image_tasks.id", ondelete="SET NULL"), nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True)
    export_format: Mapped[str] = mapped_column(String(32), nullable=False)
    export_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    archive_format: Mapped[str | None] = mapped_column(String(32), nullable=True)
    output_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default=ExportStatus.completed.value, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
