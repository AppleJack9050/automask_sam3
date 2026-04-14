from __future__ import annotations

import os
from types import SimpleNamespace
from pathlib import Path

import numpy as np
from PIL import Image

TEST_ROOT = Path(__file__).resolve().parents[3] / ".test-runtime"
os.environ["AUTOMASK_STORAGE_ROOT"] = str(TEST_ROOT / "storage")
os.environ["AUTOMASK_DATABASE_PATH"] = str(TEST_ROOT / "storage" / "automask.db")
os.environ["AUTOMASK_MODEL_BACKEND"] = "mock"

from app.services import model_backend as model_backend_module


class FakeContext:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeTorchModule:
    class cuda:
        @staticmethod
        def is_available() -> bool:
            return True

    bfloat16 = "bfloat16"

    @staticmethod
    def inference_mode():
        return FakeContext()

    @staticmethod
    def autocast(device_type: str, dtype):
        return FakeContext()


class FakePredictor:
    def set_image(self, image):  # pragma: no cover - should never be used
        raise AssertionError("Sam3ModelBackend should not call predictor.set_image directly.")


class FakeModel:
    def __init__(self) -> None:
        self.inst_interactive_predictor = FakePredictor()
        self.calls: list[dict] = []

    def predict_inst(self, inference_state, **kwargs):
        self.calls.append({"inference_state": inference_state, **kwargs})
        masks = np.zeros((3, inference_state["original_height"], inference_state["original_width"]), dtype=np.uint8)
        scores = np.array([0.1, 0.9, 0.3], dtype=np.float32)
        masks[1, 1:4, 2:6] = 1
        return masks, scores, None


class FakeProcessor:
    def __init__(self, model, device: str) -> None:
        self.model = model
        self.device = device

    def set_image(self, image: Image.Image) -> dict:
        width, height = image.size
        return {
            "original_width": width,
            "original_height": height,
            "backbone_out": {"sam2_backbone_out": {"fake": True}},
        }


def test_install_timm_layers_compat_registers_legacy_alias(monkeypatch) -> None:
    fake_layers = SimpleNamespace()
    fake_models = SimpleNamespace()

    def fake_import_module(name: str):
        if name == "timm.layers":
            return fake_layers
        if name == "timm.models":
            return fake_models
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(model_backend_module.importlib, "import_module", fake_import_module)
    monkeypatch.delitem(model_backend_module.sys.modules, "timm.models.layers", raising=False)

    model_backend_module._install_timm_layers_compat()

    assert model_backend_module.sys.modules["timm.models.layers"] is fake_layers
    assert fake_models.layers is fake_layers


def test_sam3_backend_uses_processor_state_and_predict_inst(monkeypatch, tmp_path) -> None:
    fake_model = FakeModel()

    def fake_import_module(name: str):
        if name == "torch":
            return FakeTorchModule()
        if name == "timm.layers":
            return SimpleNamespace()
        if name == "timm.models":
            return SimpleNamespace()
        if name == "sam3":
            return SimpleNamespace(build_sam3_image_model=lambda **kwargs: fake_model)
        if name == "sam3.model.sam3_image_processor":
            return SimpleNamespace(Sam3Processor=FakeProcessor)
        raise AssertionError(f"Unexpected import_module call: {name}")

    monkeypatch.setattr(model_backend_module.importlib, "import_module", fake_import_module)

    image_path = tmp_path / "sample.png"
    Image.new("RGB", (10, 8), (120, 160, 210)).save(image_path)

    backend = model_backend_module.Sam3ModelBackend(cache_size=2)
    prepared = backend.prepare_image("img-1", str(image_path))
    assert prepared.width == 10
    assert prepared.height == 8

    preview = backend.preview_mask("img-1", str(image_path), x=3, y=4)
    assert preview.shape == (8, 10)
    assert preview.max() == 255
    assert fake_model.calls
    last_call = fake_model.calls[-1]
    assert last_call["inference_state"]["original_width"] == 10
    assert last_call["inference_state"]["original_height"] == 8
    np.testing.assert_array_equal(last_call["point_coords"], np.array([[3.0, 4.0]]))
    assert last_call["normalize_coords"] is True


def test_build_sam3_or_unavailable_returns_readiness_message(monkeypatch) -> None:
    def fail_backend(*args, **kwargs):
        raise RuntimeError("CUDA-enabled PyTorch is not available.")

    monkeypatch.setattr(model_backend_module, "Sam3ModelBackend", fail_backend)

    backend = model_backend_module._build_sam3_or_unavailable()

    assert backend.name == "sam3"
    assert backend.ready is False
    assert backend.device == model_backend_module.settings.model_device
    assert backend.message == "CUDA-enabled PyTorch is not available."
