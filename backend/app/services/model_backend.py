from __future__ import annotations

import contextlib
import importlib
import sys
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image

from app.core.config import settings


@dataclass
class PreparedImage:
    width: int
    height: int


class BaseModelBackend:
    name = "base"

    def prepare_image(self, image_id: str, image_path: str) -> PreparedImage:
        raise NotImplementedError

    def preview_mask(self, image_id: str, image_path: str, x: float, y: float) -> np.ndarray:
        raise NotImplementedError


class MockModelBackend(BaseModelBackend):
    name = "mock"

    def __init__(self, cache_size: int = 8) -> None:
        self.cache_size = cache_size
        self.cache: OrderedDict[str, np.ndarray] = OrderedDict()

    def _get_image(self, image_id: str, image_path: str) -> np.ndarray:
        if image_id in self.cache:
            self.cache.move_to_end(image_id)
            return self.cache[image_id]
        image = np.array(Image.open(image_path).convert("RGB"))
        self.cache[image_id] = image
        while len(self.cache) > self.cache_size:
            self.cache.popitem(last=False)
        return image

    def prepare_image(self, image_id: str, image_path: str) -> PreparedImage:
        image = self._get_image(image_id, image_path)
        height, width = image.shape[:2]
        return PreparedImage(width=width, height=height)

    def preview_mask(self, image_id: str, image_path: str, x: float, y: float) -> np.ndarray:
        image = self._get_image(image_id, image_path)
        height, width = image.shape[:2]
        px = min(max(int(round(x)), 0), width - 1)
        py = min(max(int(round(y)), 0), height - 1)

        seed = image[py, px].astype(np.int16)
        distance = np.linalg.norm(image.astype(np.int16) - seed, axis=2)
        radius = max(12, int(min(width, height) * settings.preview_radius_ratio))
        yy, xx = np.ogrid[:height, :width]
        spatial = ((xx - px) ** 2 + (yy - py) ** 2) <= radius**2
        candidates = (distance < 48) & spatial

        if not candidates[py, px]:
            candidates[py, px] = True

        mask = np.zeros((height, width), dtype=np.uint8)
        queue = deque([(py, px)])
        visited = np.zeros((height, width), dtype=bool)
        while queue:
            cy, cx = queue.popleft()
            if visited[cy, cx] or not candidates[cy, cx]:
                continue
            visited[cy, cx] = True
            mask[cy, cx] = 255
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < height and 0 <= nx < width and not visited[ny, nx]:
                    queue.append((ny, nx))

        if not mask.any():
            ellipse = ((xx - px) ** 2) / max(radius, 1) ** 2 + ((yy - py) ** 2) / max(radius, 1) ** 2 <= 1
            mask = ellipse.astype(np.uint8) * 255
        return mask


def _install_timm_layers_compat() -> None:
    try:
        timm_layers = importlib.import_module("timm.layers")
        timm_models = importlib.import_module("timm.models")
    except ModuleNotFoundError:
        return
    # Older third-party code still imports through timm.models.layers, which now emits
    # a deprecation warning. Pre-register the new module under the legacy name so those
    # imports resolve cleanly without changing the dependency in-place.
    sys.modules.setdefault("timm.models.layers", timm_layers)
    setattr(timm_models, "layers", timm_layers)


class Sam3ModelBackend(BaseModelBackend):
    name = "sam3"

    def __init__(self, cache_size: int = 8) -> None:
        torch = importlib.import_module("torch")
        self.torch = torch
        if settings.model_device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError(
                "CUDA backend requested, but torch.cuda.is_available() is false. "
                "Install a CUDA-enabled PyTorch build and start the backend with GPU access."
            )
        _install_timm_layers_compat()
        sam3 = importlib.import_module("sam3")
        sam3_processor_module = importlib.import_module("sam3.model.sam3_image_processor")
        self.model = sam3.build_sam3_image_model(
            device=settings.model_device,
            checkpoint_path=settings.model_checkpoint_path,
            enable_inst_interactivity=True,
        )
        self.device = settings.model_device
        predictor = getattr(self.model, "inst_interactive_predictor", None)
        if predictor is None:
            raise RuntimeError("SAM3 instance interactivity predictor is unavailable.")
        self.predictor = predictor
        self.processor = sam3_processor_module.Sam3Processor(self.model, device=settings.model_device)
        self.cache_size = cache_size
        self.cache: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def _autocast_context(self):
        if settings.model_device == "cuda" and settings.preview_use_bfloat16:
            return self.torch.autocast(device_type="cuda", dtype=self.torch.bfloat16)
        return contextlib.nullcontext()

    def _load_image(self, image_path: str) -> Image.Image:
        with Image.open(image_path) as image:
            return image.convert("RGB")

    def _prime_cache(self, image_id: str, image_path: str) -> PreparedImage:
        image = self._load_image(image_path)
        with self.torch.inference_mode():
            with self._autocast_context():
                inference_state = self.processor.set_image(image)
        self.cache[image_id] = {
            "inference_state": inference_state,
        }
        self.cache.move_to_end(image_id)
        while len(self.cache) > self.cache_size:
            self.cache.popitem(last=False)
        width, height = image.size
        return PreparedImage(width=width, height=height)

    def prepare_image(self, image_id: str, image_path: str) -> PreparedImage:
        if image_id not in self.cache:
            return self._prime_cache(image_id, image_path)
        cached = self.cache[image_id]
        self.cache.move_to_end(image_id)
        height = cached["inference_state"]["original_height"]
        width = cached["inference_state"]["original_width"]
        return PreparedImage(width=width, height=height)

    def preview_mask(self, image_id: str, image_path: str, x: float, y: float) -> np.ndarray:
        if image_id not in self.cache:
            prepared = self._prime_cache(image_id, image_path)
            width, height = prepared.width, prepared.height
            inference_state = self.cache[image_id]["inference_state"]
        else:
            cached = self.cache[image_id]
            self.cache.move_to_end(image_id)
            inference_state = cached["inference_state"]
            height = inference_state["original_height"]
            width = inference_state["original_width"]

        point_coords = np.array([[min(max(float(x), 0.0), width - 1), min(max(float(y), 0.0), height - 1)]])
        point_labels = np.array([1], dtype=np.int32)
        with self.torch.inference_mode():
            with self._autocast_context():
                masks, scores, _ = self.model.predict_inst(
                    inference_state,
                    point_coords=point_coords,
                    point_labels=point_labels,
                    multimask_output=True,
                    return_logits=False,
                    normalize_coords=True,
                )
        best_index = int(np.argmax(scores))
        return (masks[best_index].astype(np.uint8) * 255)


def build_model_backend() -> BaseModelBackend:
    if settings.model_backend == "mock":
        return MockModelBackend()
    if settings.model_backend == "sam3":
        return Sam3ModelBackend()
    if settings.model_backend == "auto":
        if settings.model_device == "cuda":
            return Sam3ModelBackend()
        try:
            return Sam3ModelBackend()
        except Exception:
            return MockModelBackend()
    try:
        return Sam3ModelBackend()
    except Exception:
        return MockModelBackend()
