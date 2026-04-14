from __future__ import annotations

from app.models.entities import ImageTask, ProcessingState, WorkflowLabel


PROCESSING_STATE_KEYS = [state.value for state in ProcessingState]
WORKFLOW_LABEL_KEYS = [label.value for label in WorkflowLabel]


def processing_counts(images: list[ImageTask]) -> dict[str, int]:
    counts = {key: 0 for key in PROCESSING_STATE_KEYS}
    for image in images:
        counts[image.processing_state] = counts.get(image.processing_state, 0) + 1
    return counts


def label_counts(images: list[ImageTask]) -> dict[str, int]:
    counts = {key: 0 for key in WORKFLOW_LABEL_KEYS}
    for image in images:
        counts[image.workflow_label] = counts.get(image.workflow_label, 0) + 1
    return counts


def has_in_flight_work(images: list[ImageTask]) -> bool:
    return any(image.processing_state in {ProcessingState.queued.value, ProcessingState.preparing.value} for image in images)


def image_actions(image: ImageTask) -> dict[str, bool]:
    return {
        "canOpenEditor": image.processing_state == ProcessingState.ready.value,
        "canRemove": True,
    }


def dataset_actions(images: list[ImageTask], *, backend_ready: bool) -> dict[str, bool | str]:
    has_images = bool(images)
    has_ready = any(image.processing_state == ProcessingState.ready.value for image in images)
    has_pending_or_failed = any(
        image.processing_state in {ProcessingState.pending.value, ProcessingState.failed.value}
        for image in images
    )
    in_flight = has_in_flight_work(images)
    all_completed = has_images and all(image.workflow_label == WorkflowLabel.completed.value for image in images)

    if not has_images:
        recommended = "upload_more"
    elif in_flight:
        recommended = "processing"
    elif has_pending_or_failed:
        recommended = "start_processing"
    elif all_completed and has_ready:
        recommended = "export_dataset"
    elif has_ready:
        recommended = "review_ready"
    else:
        recommended = "upload_more"

    return {
        "canStartProcessing": backend_ready and has_pending_or_failed and not in_flight,
        "canExportDataset": has_images,
        "recommendedPrimaryAction": recommended,
    }
