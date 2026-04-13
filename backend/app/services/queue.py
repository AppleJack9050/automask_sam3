from __future__ import annotations

import asyncio
import contextlib
import inspect
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from itertools import count
from typing import Any, Awaitable, Callable
from uuid import uuid4

import numpy as np

from app.core.config import settings
from app.models.entities import ImageTask
from app.services.model_backend import BaseModelBackend


JobCallable = Callable[[], Any | Awaitable[Any]]


@dataclass(order=True)
class QueueJob:
    priority: int
    sequence: int
    job_id: str = field(compare=False)
    callback: JobCallable = field(compare=False)
    future: asyncio.Future[Any] = field(compare=False)
    image_id: str | None = field(compare=False, default=None)
    preview_generation: int | None = field(compare=False, default=None)


@dataclass
class PreviewCacheItem:
    image_id: str
    preview_id: str
    prompt: dict[str, float]
    mask: np.ndarray
    created_at: datetime


class InferenceQueue:
    def __init__(self, backend: BaseModelBackend) -> None:
        self.backend = backend
        self.queue: asyncio.PriorityQueue[QueueJob] = asyncio.PriorityQueue()
        self.counter = count()
        self.worker_task: asyncio.Task[None] | None = None
        self.preview_cache: dict[str, PreviewCacheItem] = {}
        self.preview_generations: dict[str, int] = {}
        self.preview_futures: dict[str, asyncio.Future[Any]] = {}

    async def start(self) -> None:
        if self.worker_task is None:
            self.worker_task = asyncio.create_task(self._worker(), name="automask-inference-worker")

    async def stop(self) -> None:
        if self.worker_task is not None:
            self.worker_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.worker_task
            self.worker_task = None

    async def _worker(self) -> None:
        while True:
            job = await self.queue.get()
            try:
                if job.image_id is not None and job.preview_generation is not None:
                    latest_generation = self.preview_generations.get(job.image_id, 0)
                    if job.future.cancelled() or job.preview_generation != latest_generation:
                        continue
                result = job.callback()
                if inspect.isawaitable(result):
                    result = await result
                if job.image_id is not None and job.preview_generation is not None:
                    latest_generation = self.preview_generations.get(job.image_id, 0)
                    if job.future.cancelled() or job.preview_generation != latest_generation:
                        continue
                if not job.future.cancelled():
                    job.future.set_result(result)
            except Exception as exc:  # pragma: no cover - defensive
                if not job.future.cancelled():
                    job.future.set_exception(exc)
            finally:
                self.queue.task_done()

    async def submit(self, priority: int, callback: JobCallable) -> Any:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        await self.queue.put(
            QueueJob(
                priority=priority,
                sequence=next(self.counter),
                job_id=str(uuid4()),
                callback=callback,
                future=future,
            )
        )
        return await future

    async def submit_preview(self, image_id: str, priority: int, callback: JobCallable) -> Any:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        next_generation = self.preview_generations.get(image_id, 0) + 1
        self.preview_generations[image_id] = next_generation

        previous_future = self.preview_futures.get(image_id)
        if previous_future is not None and not previous_future.done():
            previous_future.cancel()
        self.preview_futures[image_id] = future

        await self.queue.put(
            QueueJob(
                priority=priority,
                sequence=next(self.counter),
                job_id=str(uuid4()),
                callback=callback,
                future=future,
                image_id=image_id,
                preview_generation=next_generation,
            )
        )
        try:
            return await future
        finally:
            if self.preview_futures.get(image_id) is future:
                self.preview_futures.pop(image_id, None)

    def submit_background(self, priority: int, callback: JobCallable) -> asyncio.Task[Any]:
        async def runner() -> Any:
            return await self.submit(priority, callback)

        return asyncio.create_task(runner())

    def store_preview(self, image: ImageTask, mask: np.ndarray, prompt: dict[str, float]) -> str:
        self._prune_previews()
        preview_id = str(uuid4())
        self.preview_cache[preview_id] = PreviewCacheItem(
            image_id=image.id,
            preview_id=preview_id,
            prompt=prompt,
            mask=mask,
            created_at=datetime.now(timezone.utc),
        )
        return preview_id

    def consume_preview(self, image_id: str, preview_id: str) -> PreviewCacheItem | None:
        item = self.preview_cache.get(preview_id)
        if item is None or item.image_id != image_id:
            return None
        self.preview_cache.pop(preview_id, None)
        return item

    def discard_image(self, image_id: str) -> None:
        preview_ids = [preview_id for preview_id, item in self.preview_cache.items() if item.image_id == image_id]
        for preview_id in preview_ids:
            self.preview_cache.pop(preview_id, None)
        self.preview_generations.pop(image_id, None)
        future = self.preview_futures.pop(image_id, None)
        if future is not None and not future.done():
            future.cancel()

    def _prune_previews(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.preview_ttl_seconds)
        expired = [preview_id for preview_id, item in self.preview_cache.items() if item.created_at < cutoff]
        for preview_id in expired:
            self.preview_cache.pop(preview_id, None)
