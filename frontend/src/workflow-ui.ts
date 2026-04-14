import type {
  ArchiveFormat,
  Dataset,
  ExportFormat,
  ExportMode,
  HealthStatus,
  ProcessingState,
  RecommendedPrimaryAction,
  UploadEntry,
  WorkflowLabel,
} from './types'

export const workflowOptions: WorkflowLabel[] = ['todo', 'in_progress', 'completed']
export const formatOptions: ExportFormat[] = ['png', 'jpg', 'bmp', 'tiff']
export const archiveOptions: ArchiveFormat[] = ['zip', 'tar.gz']
export const exportModes: ExportMode[] = ['transparent', 'binary_mask', 'overlay']
export const processingStateOptions: Array<ProcessingState | 'all'> = [
  'all',
  'pending',
  'queued',
  'preparing',
  'ready',
  'failed',
]

const workflowLabels: Record<WorkflowLabel, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  completed: 'Completed',
}

const processingLabels: Record<ProcessingState, string> = {
  pending: 'Pending',
  queued: 'Queued',
  preparing: 'Preparing',
  ready: 'Ready',
  failed: 'Failed',
}

const primaryActionCopy: Record<
  RecommendedPrimaryAction,
  { title: string; description: string; buttonLabel: string }
> = {
  start_processing: {
    title: 'Start sequential processing',
    description: 'This dataset still has pending or failed images that need preparation before editing.',
    buttonLabel: 'Start processing',
  },
  processing: {
    title: 'Preparation is in progress',
    description: 'The queue is already working through this dataset. You can review items as they become ready.',
    buttonLabel: 'Processing…',
  },
  review_ready: {
    title: 'Review prepared images',
    description: 'At least one image is ready for the editor, so the next useful step is review and cleanup.',
    buttonLabel: 'Review ready images',
  },
  export_dataset: {
    title: 'Export the finished dataset',
    description: 'Everything looks prepared for downstream use, so export is the most direct next step.',
    buttonLabel: 'Export dataset',
  },
  upload_more: {
    title: 'Add source images',
    description: 'There are no staged images yet. Upload files or a folder to start a new task list.',
    buttonLabel: 'Upload more',
  },
}

export function formatWorkflowLabel(label: WorkflowLabel) {
  return workflowLabels[label]
}

export function formatProcessingState(state: ProcessingState) {
  return processingLabels[state]
}

export function getPrimaryActionCopy(action: RecommendedPrimaryAction) {
  return primaryActionCopy[action]
}

export function getStartProcessingReason(dataset: Dataset, health: HealthStatus | null) {
  if (dataset.actions.canStartProcessing) {
    return null
  }
  if (health && !health.ready) {
    return health.message ?? 'The model backend is not ready yet.'
  }
  if (dataset.summary.hasInFlightWork) {
    return 'Sequential preparation is already running for this dataset.'
  }
  return 'Everything that can be prepared is already ready for review.'
}

export function getDatasetExportReason(dataset: Dataset) {
  if (dataset.actions.canExportDataset) {
    return null
  }
  return 'Export becomes available after this dataset has at least one image.'
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

export function summarizeSelectionTypes(entries: UploadEntry[]) {
  const kinds = new Set<string>()
  for (const entry of entries) {
    const path = entry.relativePath.toLowerCase()
    if (path.endsWith('.zip') || path.endsWith('.tar.gz') || path.endsWith('.tgz')) {
      kinds.add('archives')
    } else if (path.endsWith('.dng')) {
      kinds.add('raw dng')
    } else {
      kinds.add('images')
    }
  }
  return [...kinds]
}
