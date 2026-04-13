from __future__ import annotations

import base64
import hashlib
import io
import json
import shutil
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

import numpy as np
import rawpy
from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

from app.core.config import settings


RASTER_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
RAW_IMAGE_EXTENSIONS = {".dng"}
IMAGE_EXTENSIONS = RASTER_IMAGE_EXTENSIONS | RAW_IMAGE_EXTENSIONS
ARCHIVE_EXTENSIONS = {".zip", ".tar.gz", ".tgz"}
ALLOWED_EXPORT_FORMATS = {"png", "jpg", "bmp", "tiff"}
TRANSPARENT_EXPORT_FORMATS = {"png", "tiff"}


class StorageService:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.datasets_dir = root / "datasets"
        self.archives_dir = root / "archives"
        self.masks_dir = root / "masks"
        self.histories_dir = root / "histories"
        self.exports_dir = root / "exports"

    def ensure_layout(self) -> None:
        for path in [
            self.root,
            self.datasets_dir,
            self.archives_dir,
            self.masks_dir,
            self.histories_dir,
            self.exports_dir,
        ]:
            path.mkdir(parents=True, exist_ok=True)

    def dataset_originals_dir(self, dataset_id: str) -> Path:
        return self.datasets_dir / dataset_id / "originals"

    def dataset_root(self, dataset_id: str) -> Path:
        return self.datasets_dir / dataset_id

    def history_dir(self, image_id: str) -> Path:
        return self.histories_dir / image_id

    def history_path(self, image_id: str) -> Path:
        return self.history_dir(image_id) / "history.json"

    def history_snapshots_dir(self, image_id: str) -> Path:
        return self.history_dir(image_id) / "snapshots"

    def mask_path(self, image_id: str) -> Path:
        return self.masks_dir / f"{image_id}.png"

    def export_dir(self, export_id: str) -> Path:
        return self.exports_dir / export_id

    def archive_path(self, dataset_id: str, filename: str) -> Path:
        return self.archives_dir / dataset_id / filename

    def sanitize_relative_path(self, value: str) -> str:
        path = PurePosixPath(value.replace("\\", "/"))
        if path.is_absolute():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Absolute paths are not allowed: {value}")
        parts = [part for part in path.parts if part not in {"", "."}]
        if not parts:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty relative paths are not allowed.")
        if any(part == ".." for part in parts):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsafe relative path: {value}")
        return PurePosixPath(*parts).as_posix()

    def save_upload_file(self, upload: UploadFile, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        size_limit = settings.max_file_size_mb * 1024 * 1024
        total = 0
        with destination.open("wb") as handle:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > size_limit:
                    handle.close()
                    destination.unlink(missing_ok=True)
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"{upload.filename} exceeds the {settings.max_file_size_mb} MB upload limit.",
                    )
                handle.write(chunk)
        upload.file.seek(0)

    def validate_image(self, path: Path) -> tuple[int, int]:
        try:
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                width, height = image.size
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{path.name} is not a readable image file.",
            ) from exc
        return width, height

    def _working_image_path(self, raw_path: Path) -> Path:
        return raw_path.with_name(f"{raw_path.stem}__automask.tiff")

    def _rasterize_raw_image(self, path: Path) -> tuple[Path, int, int]:
        try:
            with rawpy.imread(str(path)) as raw:
                rgb = raw.postprocess(use_camera_wb=True, output_bps=8)
        except Exception as exc:  # pragma: no cover - depends on raw decoder/runtime
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{path.name} could not be decoded as a DNG image.",
            ) from exc

        working_path = self._working_image_path(path)
        working_path.parent.mkdir(parents=True, exist_ok=True)
        image = Image.fromarray(rgb)
        image.save(working_path, format="TIFF")
        width, height = image.size
        return working_path, width, height

    def prepare_ingested_image(self, path: Path) -> tuple[Path, int, int]:
        if path.suffix.lower() in RAW_IMAGE_EXTENSIONS:
            return self._rasterize_raw_image(path)
        width, height = self.validate_image(path)
        return path, width, height

    def write_blank_history(self, image_id: str) -> Path:
        history_path = self.history_path(image_id)
        history_path.parent.mkdir(parents=True, exist_ok=True)
        self.history_snapshots_dir(image_id).mkdir(parents=True, exist_ok=True)
        history_path.write_text(
            json.dumps({"imageId": image_id, "cursor": -1, "actions": [], "maxDepth": settings.history_depth}, indent=2),
            encoding="utf-8",
        )
        return history_path

    def load_mask(self, mask_path: str | Path, width: int, height: int) -> np.ndarray:
        path = Path(mask_path)
        if not path.exists():
            return np.zeros((height, width), dtype=np.uint8)
        with Image.open(path) as image:
            return np.array(image.convert("L"), dtype=np.uint8)

    def save_mask(self, mask: np.ndarray, destination: str | Path) -> None:
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(mask.astype(np.uint8)).save(path, format="PNG")

    def remove_mask(self, destination: str | Path) -> None:
        Path(destination).unlink(missing_ok=True)

    def mask_to_base64(self, mask: np.ndarray) -> str:
        image = Image.fromarray(mask.astype(np.uint8))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode("ascii")

    def image_to_rgb(self, path: str | Path) -> Image.Image:
        image_path = Path(path)
        if image_path.suffix.lower() in RAW_IMAGE_EXTENSIONS:
            with rawpy.imread(str(image_path)) as raw:
                return Image.fromarray(raw.postprocess(use_camera_wb=True, output_bps=8))
        with Image.open(image_path) as image:
            return image.convert("RGB")

    def digest_mask(self, mask: np.ndarray) -> str:
        return hashlib.sha256(mask.tobytes()).hexdigest()

    def export_filename(self, relative_path: str, extension: str) -> str:
        relative = Path(relative_path)
        return str(relative.with_suffix(f".{extension}"))

    def _extract_zip(self, archive_path: Path, destination_root: Path) -> list[tuple[str, Path]]:
        extracted: list[tuple[str, Path]] = []
        with zipfile.ZipFile(archive_path) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                relative = self.sanitize_relative_path(info.filename)
                if Path(relative).name.startswith(".") or relative.startswith("__MACOSX/"):
                    continue
                if Path(relative).suffix.lower() not in IMAGE_EXTENSIONS:
                    continue
                destination = destination_root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target)
                extracted.append((relative, destination))
        return extracted

    def _extract_tar(self, archive_path: Path, destination_root: Path) -> list[tuple[str, Path]]:
        extracted: list[tuple[str, Path]] = []
        with tarfile.open(archive_path, "r:*") as archive:
            for member in archive.getmembers():
                if not member.isfile():
                    continue
                relative = self.sanitize_relative_path(member.name)
                if Path(relative).name.startswith(".") or relative.startswith("__MACOSX/"):
                    continue
                if Path(relative).suffix.lower() not in IMAGE_EXTENSIONS:
                    continue
                destination = destination_root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    continue
                with source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target)
                extracted.append((relative, destination))
        return extracted

    def extract_archive(self, archive_path: Path, destination_root: Path) -> list[tuple[str, Path]]:
        destination_root.mkdir(parents=True, exist_ok=True)
        if archive_path.name.endswith(".zip"):
            items = self._extract_zip(archive_path, destination_root)
        else:
            items = self._extract_tar(archive_path, destination_root)
        if not items:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{archive_path.name} does not contain supported images.")
        return items


storage_service = StorageService(settings.storage_root)
