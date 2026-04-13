import type {
  ArchiveFormat,
  Dataset,
  EditorState,
  ExportFormat,
  ExportMode,
  PreviewResponse,
  UploadEntry,
  UploadProgressEntry,
  WorkflowLabel,
} from './types'

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

function apiUrl(path: string) {
  return `${API_BASE}${path}`
}

async function parseError(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string }
    return body.detail ?? 'Request failed.'
  } catch {
    return `Request failed with status ${response.status}.`
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(await parseError(response))
  }

  return (await response.json()) as T
}

function distributeUploadProgress(
  entries: UploadEntry[],
  ratio: number,
): UploadProgressEntry[] {
  const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0)
  const loadedBytes = totalBytes * ratio
  let offset = 0

  return entries.map((entry) => {
    const nextOffset = offset + entry.file.size
    const progress = Math.min(
      1,
      Math.max(0, (loadedBytes - offset) / Math.max(entry.file.size, 1)),
    )
    offset = nextOffset
    return {
      relativePath: entry.relativePath,
      progress,
    }
  })
}

export function uploadEntries(
  entries: UploadEntry[],
  datasetName: string,
  onProgress: (items: UploadProgressEntry[]) => void,
) {
  return new Promise<Dataset>((resolve, reject) => {
    const formData = new FormData()
    formData.append('dataset_name', datasetName)
    formData.append(
      'manifest',
      JSON.stringify(
        entries.map((entry, index) => ({
          index,
          relativePath: entry.relativePath,
          size: entry.file.size,
        })),
      ),
    )
    for (const entry of entries) {
      formData.append('files', entry.file, entry.file.name)
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl('/api/uploads'))
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return
      }
      onProgress(distributeUploadProgress(entries, event.loaded / event.total))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(entries.map((entry) => ({ relativePath: entry.relativePath, progress: 1 })))
        resolve(xhr.response as Dataset)
        return
      }

      const error =
        (xhr.response as { detail?: string } | null)?.detail ??
        `Upload failed with status ${xhr.status}.`
      reject(new Error(error))
    }
    xhr.onerror = () => reject(new Error('Upload failed because the network request did not complete.'))
    xhr.send(formData)
  })
}

export function getDataset(datasetId: string) {
  return fetchJson<Dataset>(`/api/datasets/${datasetId}`)
}

export function startDataset(datasetId: string) {
  return fetchJson<Dataset>(`/api/datasets/${datasetId}/start`, {
    method: 'POST',
  })
}

export function updateWorkflowLabel(imageId: string, workflowLabel: WorkflowLabel) {
  return fetchJson(`/api/images/${imageId}/workflow-label`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ workflowLabel }),
  })
}

export function getEditorState(imageId: string) {
  return fetchJson<EditorState>(`/api/images/${imageId}`)
}

export function requestPreview(
  imageId: string,
  x: number,
  y: number,
  requestId: string,
  signal?: AbortSignal,
) {
  return fetchJson<PreviewResponse>(`/api/images/${imageId}/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ x, y, requestId }),
    signal,
  })
}

export function commitPreview(
  imageId: string,
  mode: 'mask' | 'unmask',
  previewId: string,
  prompt: { x: number; y: number },
) {
  return fetchJson<EditorState>(`/api/images/${imageId}/${mode}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ previewId, prompt }),
  })
}

export function undoEdit(imageId: string) {
  return fetchJson<EditorState>(`/api/images/${imageId}/undo`, { method: 'POST' })
}

export function redoEdit(imageId: string) {
  return fetchJson<EditorState>(`/api/images/${imageId}/redo`, { method: 'POST' })
}

export function restoreEdit(imageId: string) {
  return fetchJson<EditorState>(`/api/images/${imageId}/restore`, { method: 'POST' })
}

function filenameFromDisposition(header: string | null, fallback: string) {
  if (!header) {
    return fallback
  }
  const match = /filename="?([^"]+)"?/i.exec(header)
  return match?.[1] ?? fallback
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function downloadResponse(response: Response, fallbackName: string) {
  if (!response.ok) {
    throw new Error(await parseError(response))
  }
  const blob = await response.blob()
  saveBlob(blob, filenameFromDisposition(response.headers.get('content-disposition'), fallbackName))
}

export async function exportImage(
  imageId: string,
  format: ExportFormat,
  mode: ExportMode,
  fallbackName: string,
) {
  const response = await fetch(apiUrl(`/api/exports/image/${imageId}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ format, mode }),
  })
  await downloadResponse(response, fallbackName)
}

export async function exportDataset(
  datasetId: string,
  format: ExportFormat,
  mode: ExportMode,
  archiveFormat: ArchiveFormat,
  fallbackName: string,
) {
  const response = await fetch(apiUrl(`/api/exports/dataset/${datasetId}`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ format, mode, archiveFormat }),
  })
  await downloadResponse(response, fallbackName)
}
