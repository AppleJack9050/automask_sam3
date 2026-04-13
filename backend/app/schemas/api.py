from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class UploadManifestEntry(BaseModel):
    index: int
    relativePath: str
    size: int


class UploadResponseImage(BaseModel):
    id: str
    datasetId: str
    relativePath: str
    width: int | None
    height: int | None
    workflowLabel: str
    processingState: str
    hasSavedMask: bool
    historyDepth: int
    lastError: str | None = None
    originalUrl: str
    historyUrl: str


class DatasetResponse(BaseModel):
    id: str
    name: str
    sourceType: str
    rootPath: str
    itemCount: int
    createdAt: datetime
    images: list[UploadResponseImage]


class WorkflowLabelUpdate(BaseModel):
    workflowLabel: str


class PreviewRequest(BaseModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    requestId: str | None = None


class PreviewResponse(BaseModel):
    previewId: str
    requestId: str | None = None
    maskPngBase64: str
    prompt: dict[str, float]


class CommitPreviewRequest(BaseModel):
    previewId: str
    prompt: dict[str, Any]


class EditorStateResponse(BaseModel):
    id: str
    datasetId: str
    relativePath: str
    width: int
    height: int
    workflowLabel: str
    processingState: str
    hasSavedMask: bool
    historyDepth: int
    canUndo: bool
    canRedo: bool
    originalUrl: str
    historyUrl: str
    committedMaskPngBase64: str | None = None


class ExportImageRequest(BaseModel):
    format: str
    mode: str


class ExportDatasetRequest(BaseModel):
    format: str
    mode: str
    archiveFormat: str
