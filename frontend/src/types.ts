export type WorkflowLabel = 'todo' | 'in_progress' | 'completed'
export type ProcessingState = 'pending' | 'queued' | 'preparing' | 'ready' | 'failed'
export type ExportMode = 'transparent' | 'binary_mask' | 'overlay'
export type ExportFormat = 'png' | 'jpg' | 'bmp' | 'tiff'
export type ArchiveFormat = 'zip' | 'tar.gz'

export type UploadEntry = {
  file: File
  relativePath: string
}

export type UploadProgressEntry = {
  relativePath: string
  progress: number
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
}

export type Dataset = {
  id: string
  name: string
  sourceType: string
  rootPath: string
  itemCount: number
  createdAt: string
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
