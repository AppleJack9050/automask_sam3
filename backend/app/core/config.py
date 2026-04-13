from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    app_name: str = "AutoMask"
    storage_root: Path = Path(os.getenv("AUTOMASK_STORAGE_ROOT", _repo_root() / "storage"))
    database_path: Path = Path(os.getenv("AUTOMASK_DATABASE_PATH", _repo_root() / "storage" / "automask.db"))
    model_backend: str = os.getenv("AUTOMASK_MODEL_BACKEND", "sam3")
    model_checkpoint_path: str | None = os.getenv("AUTOMASK_MODEL_CHECKPOINT")
    model_device: str = os.getenv("AUTOMASK_MODEL_DEVICE", "cuda")
    max_file_size_mb: int = int(os.getenv("AUTOMASK_MAX_FILE_SIZE_MB", "512"))
    preview_priority: int = 0
    prepare_priority: int = 10
    history_depth: int = int(os.getenv("AUTOMASK_HISTORY_DEPTH", "10"))
    preview_radius_ratio: float = float(os.getenv("AUTOMASK_MOCK_PREVIEW_RADIUS_RATIO", "0.18"))
    preview_ttl_seconds: int = int(os.getenv("AUTOMASK_PREVIEW_TTL_SECONDS", "300"))
    preview_use_bfloat16: bool = os.getenv("AUTOMASK_PREVIEW_USE_BFLOAT16", "1") == "1"


settings = Settings()
