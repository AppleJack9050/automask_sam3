export type WorkflowLabel = 'todo' | 'in_progress' | 'completed'
export type ProcessingState = 'pending' | 'queued' | 'preparing' | 'ready' | 'failed'
export type ExportMode = 'transparent' | 'binary_mask' | 'overlay'
export type ExportFormat = 'png' | 'jpg' | 'bmp' | 'tiff'
export type ArchiveFormat = 'zip' | 'tar.gz'
export type RecommendedPrimaryAction =
  | 'start_processing'
  | 'processing'
  | 'review_ready'
  | 'export_dataset'
  | 'upload_more'

export type UploadEntry = {
  file: File
  relativePath: string
}

export type UploadProgressEntry = {
  relativePath: string
  progress: number
}

export type HealthStatus = {
  status: string
  backend: string
  device: string
  ready: boolean
  message?: string | null
}

export type ImageActions = {
  canOpenEditor: boolean
  canRemove: boolean
}

export type DatasetSummary = {
  processingCounts: Record<ProcessingState, number>
  labelCounts: Record<WorkflowLabel, number>
  hasInFlightWork: boolean
}

export type DatasetActions = {
  canStartProcessing: boolean
  canExportDataset: boolean
  recommendedPrimaryAction: RecommendedPrimaryAction
}

export type DatasetImage = {
  id: string
  datasetId: string
  relativePath: string
  width: number | null
  height: number | null
  workflowLabel: WorkflowLabel
  processingState: ProcessingState
  hasSavedMask: boolean
  historyDepth: number
  lastError?: string | null
  originalUrl: string
  historyUrl: string
  actions: ImageActions
}

export type Dataset = {
  id: string
  name: string
  sourceType: string
  rootPath: string
  itemCount: number
  createdAt: string
  summary: DatasetSummary
  actions: DatasetActions
  images: DatasetImage[]
}

export type EditorState = {
  id: string
  datasetId: string
  relativePath: string
  width: number
  height: number
  workflowLabel: WorkflowLabel
  processingState: ProcessingState
  hasSavedMask: boolean
  historyDepth: number
  canUndo: boolean
  canRedo: boolean
  originalUrl: string
  historyUrl: string
  committedMaskPngBase64?: string | null
}

export type PreviewResponse = {
  previewId: string
  requestId?: string | null
  maskPngBase64: string
  prompt: {
    x: number
    y: number
  }
}
