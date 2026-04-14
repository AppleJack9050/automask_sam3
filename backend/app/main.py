from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.core.config import settings
from app.core.database import Base, engine
from app.services.model_backend import build_model_backend
from app.services.queue import InferenceQueue
from app.services.storage import storage_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage_service.ensure_layout()
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    app.state.inference_queue = InferenceQueue(build_model_backend())
    await app.state.inference_queue.start()
    try:
        yield
    finally:
        await app.state.inference_queue.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
