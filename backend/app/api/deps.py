from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import Dataset, ImageTask


def get_dataset(db: Session, dataset_id: str) -> Dataset:
    dataset = db.scalar(
        select(Dataset)
        .where(Dataset.id == dataset_id)
        .options(selectinload(Dataset.images))
    )
    if dataset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dataset not found.")
    return dataset


def get_image(db: Session, image_id: str) -> ImageTask:
    image = db.scalar(select(ImageTask).where(ImageTask.id == image_id))
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found.")
    return image


def get_dataset_image(db: Session, dataset_id: str, image_id: str) -> tuple[Dataset, ImageTask]:
    dataset = db.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dataset not found.")
    image = db.scalar(
        select(ImageTask).where(
            ImageTask.id == image_id,
            ImageTask.dataset_id == dataset_id,
        )
    )
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found.")
    return dataset, image
