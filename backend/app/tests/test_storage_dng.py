from __future__ import annotations

import numpy as np
from PIL import Image

from app.services.storage import StorageService


class FakeRawReader:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def postprocess(self, use_camera_wb: bool, output_bps: int):
        assert use_camera_wb is True
        assert output_bps == 8
        rgb = np.zeros((6, 9, 3), dtype=np.uint8)
        rgb[..., 0] = 120
        rgb[..., 1] = 160
        rgb[..., 2] = 200
        return rgb


def test_prepare_ingested_image_rasterizes_dng(monkeypatch, tmp_path) -> None:
    service = StorageService(tmp_path)
    service.ensure_layout()
    dng_path = tmp_path / "DJI_0001.DNG"
    dng_path.write_bytes(b"fake-dng")

    monkeypatch.setattr("app.services.storage.rawpy.imread", lambda path: FakeRawReader())

    working_path, width, height = service.prepare_ingested_image(dng_path)

    assert working_path.name == "DJI_0001__automask.tiff"
    assert width == 9
    assert height == 6
    assert working_path.exists()

    with Image.open(working_path) as image:
        assert image.size == (9, 6)
