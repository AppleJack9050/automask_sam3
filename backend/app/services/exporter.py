from __future__ import annotations

import shutil
import tarfile
import zipfile
from pathlib import Path
from uuid import uuid4

import numpy as np
from PIL import Image
from sqlalchemy.orm import Session

from app.models.entities import ArchiveFormat, ExportMode, ExportRequest, ExportStatus, ImageTask
from app.services.history import history_service
from app.services.storage import TRANSPARENT_EXPORT_FORMATS, storage_service


def _pil_format(export_format: str) -> str:
    if export_format == "jpg":
        return "JPEG"
    if export_format == "tiff":
        return "TIFF"
    return export_format.upper()


class ExportService:
    def _load_original(self, image: ImageTask) -> Image.Image:
        with Image.open(image.original_path) as original:
            return original.convert("RGBA")

    def _render(self, image: ImageTask, export_format: str, mode: str) -> Image.Image:
        original = self._load_original(image)
        mask = history_service.load_committed_mask(image)
        foreground = (255 - mask).astype(np.uint8)

        if mode == ExportMode.transparent.value:
            if export_format not in TRANSPARENT_EXPORT_FORMATS:
                raise ValueError("Transparent export is only available for PNG and TIFF.")
            rendered = original.copy()
            rendered.putalpha(Image.fromarray(foreground))
            return rendered

        if mode == ExportMode.binary_mask.value:
            binary = Image.fromarray(foreground)
            if export_format in {"jpg", "bmp"}:
                return binary.convert("RGB")
            return binary

        overlay = original.copy()
        overlay_mask = Image.fromarray(mask)
        tint = Image.new("RGBA", overlay.size, (234, 68, 53, 150))
        overlay.alpha_composite(Image.composite(tint, Image.new("RGBA", overlay.size, (0, 0, 0, 0)), overlay_mask))
        if export_format in {"jpg", "bmp"}:
            return overlay.convert("RGB")
        return overlay

    def export_image(self, db: Session, image: ImageTask, export_format: str, mode: str) -> Path:
        export_id = str(uuid4())
        export_dir = storage_service.export_dir(export_id)
        export_dir.mkdir(parents=True, exist_ok=True)
        relative_output = storage_service.export_filename(image.relative_path, export_format)
        output_path = export_dir / Path(relative_output).name
        rendered = self._render(image, export_format, mode)
        rendered.save(output_path, format=_pil_format(export_format))
        db.add(
            ExportRequest(
                id=export_id,
                image_id=image.id,
                dataset_id=image.dataset_id,
                export_format=export_format,
                export_mode=mode,
                archive_format=None,
                output_path=str(output_path),
                status=ExportStatus.completed.value,
            )
        )
        return output_path

    def export_dataset(self, db: Session, images: list[ImageTask], export_format: str, mode: str, archive_format: str) -> Path:
        export_id = str(uuid4())
        export_dir = storage_service.export_dir(export_id)
        staging_dir = export_dir / "staging"
        staging_dir.mkdir(parents=True, exist_ok=True)

        for image in images:
            output_relative = Path(storage_service.export_filename(image.relative_path, export_format))
            output_path = staging_dir / output_relative
            output_path.parent.mkdir(parents=True, exist_ok=True)
            rendered = self._render(image, export_format, mode)
            rendered.save(output_path, format=_pil_format(export_format))

        archive_suffix = "zip" if archive_format == ArchiveFormat.zip.value else "tar.gz"
        archive_name = f"dataset-export.{archive_suffix}"
        archive_path = export_dir / archive_name
        if archive_format == ArchiveFormat.zip.value:
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for file_path in staging_dir.rglob("*"):
                    if file_path.is_file():
                        archive.write(file_path, file_path.relative_to(staging_dir))
        else:
            with tarfile.open(archive_path, "w:gz") as archive:
                archive.add(staging_dir, arcname=".")

        shutil.rmtree(staging_dir, ignore_errors=True)
        db.add(
            ExportRequest(
                id=export_id,
                image_id=None,
                dataset_id=images[0].dataset_id if images else None,
                export_format=export_format,
                export_mode=mode,
                archive_format=archive_format,
                output_path=str(archive_path),
                status=ExportStatus.completed.value,
            )
        )
        return archive_path


export_service = ExportService()
