import { startTransition, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  deleteDatasetImage,
  exportDataset,
  exportImage,
  getDataset,
  startDataset,
  updateWorkflowLabel,
} from '../api'
import type { ArchiveFormat, Dataset, ExportFormat, ExportMode, WorkflowLabel } from '../types'

const workflowOptions: WorkflowLabel[] = ['todo', 'in_progress', 'completed']
const formatOptions: ExportFormat[] = ['png', 'jpg', 'bmp', 'tiff']
const archiveOptions: ArchiveFormat[] = ['zip', 'tar.gz']
const exportModes: ExportMode[] = ['transparent', 'binary_mask', 'overlay']

export function DatasetPage() {
  const { datasetId = '' } = useParams()
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png')
  const [exportMode, setExportMode] = useState<ExportMode>('transparent')
  const [archiveFormat, setArchiveFormat] = useState<ArchiveFormat>('zip')
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    if (!datasetId) {
      return
    }

    let active = true
    getDataset(datasetId)
      .then((nextDataset) => {
        if (active) {
          setDataset(nextDataset)
          setError(null)
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load dataset.')
        }
      })

    return () => {
      active = false
    }
  }, [datasetId])

  useEffect(() => {
    if (!dataset?.images.some((image) => image.processingState === 'queued' || image.processingState === 'preparing')) {
      return
    }

    const timer = window.setInterval(() => {
      getDataset(dataset.id)
        .then((nextDataset) => {
          startTransition(() => setDataset(nextDataset))
        })
        .catch(() => undefined)
    }, 1600)

    return () => window.clearInterval(timer)
  }, [dataset])

  const readyCount = useMemo(
    () => dataset?.images.filter((image) => image.processingState === 'ready').length ?? 0,
    [dataset],
  )

  const onStart = async () => {
    if (!dataset) {
      return
    }
    try {
      setError(null)
      setIsStarting(true)
      const nextDataset = await startDataset(dataset.id)
      setDataset(nextDataset)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to start dataset processing.')
    } finally {
      setIsStarting(false)
    }
  }

  const onUpdateLabel = async (imageId: string, workflowLabel: WorkflowLabel) => {
    if (!dataset) {
      return
    }
    try {
      await updateWorkflowLabel(imageId, workflowLabel)
      setDataset({
        ...dataset,
        images: dataset.images.map((image) =>
          image.id === imageId ? { ...image, workflowLabel } : image,
        ),
      })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update the workflow label.')
    }
  }

  const effectiveFormat =
    exportMode === 'transparent' && (exportFormat === 'jpg' || exportFormat === 'bmp')
      ? 'png'
      : exportFormat

  const onExportDataset = async () => {
    if (!dataset) {
      return
    }
    try {
      setExportingId('dataset')
      await exportDataset(
        dataset.id,
        effectiveFormat,
        exportMode,
        archiveFormat,
        `${dataset.name}.${archiveFormat === 'zip' ? 'zip' : 'tar.gz'}`,
      )
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Dataset export failed.')
    } finally {
      setExportingId(null)
    }
  }

  const onExportImage = async (imageId: string, relativePath: string) => {
    try {
      setExportingId(imageId)
      await exportImage(
        imageId,
        effectiveFormat,
        exportMode,
        relativePath.replace(/\.[^.]+$/, `.${effectiveFormat}`),
      )
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Image export failed.')
    } finally {
      setExportingId(null)
    }
  }

  const onRemoveImage = async (imageId: string, relativePath: string) => {
    if (!dataset) {
      return
    }
    const confirmed = window.confirm(`Remove ${relativePath} from this dataset task list?`)
    if (!confirmed) {
      return
    }
    try {
      setError(null)
      setRemovingId(imageId)
      const nextDataset = await deleteDatasetImage(dataset.id, imageId)
      setDataset(nextDataset)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to remove the image from the dataset.')
    } finally {
      setRemovingId(null)
    }
  }

  if (!dataset) {
    return (
      <section className="page">
        <div className="panel">
          <h1>Dataset loading</h1>
          <p>{error ?? 'Reading dataset inventory…'}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="page dataset-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Dataset workspace</p>
          <h1>{dataset.name}</h1>
          <p className="lead">
            {dataset.itemCount} files staged. {readyCount} ready for interactive editing.
          </p>
        </div>
        <div className="toolbar-card">
          <button className="primary-button" type="button" onClick={onStart} disabled={isStarting}>
            {isStarting ? 'Queueing…' : 'Start sequential processing'}
          </button>
          <Link className="secondary-button" to="/">
            Upload more data
          </Link>
        </div>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      <div className="export-card">
        <div className="section-heading">
          <h2>Dataset export</h2>
          <span>{dataset.rootPath}</span>
        </div>
        <div className="toolbar-grid">
          <label>
            Export mode
            <select value={exportMode} onChange={(event) => setExportMode(event.target.value as ExportMode)}>
              {exportModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label>
            Image format
            <select value={effectiveFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
              {formatOptions.map((format) => (
                <option
                  key={format}
                  value={format}
                  disabled={exportMode === 'transparent' && (format === 'jpg' || format === 'bmp')}
                >
                  {format}
                </option>
              ))}
            </select>
          </label>
          <label>
            Archive format
            <select value={archiveFormat} onChange={(event) => setArchiveFormat(event.target.value as ArchiveFormat)}>
              {archiveOptions.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={onExportDataset}
            disabled={exportingId === 'dataset' || dataset.images.length === 0}
          >
            {exportingId === 'dataset' ? 'Exporting…' : 'Download dataset'}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Task list</h2>
          <span>Labels are manual workflow markers only.</span>
        </div>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Status</th>
                <th>Label</th>
                <th>History</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dataset.images.length === 0 ? (
                <tr>
                  <td className="empty-table-state" colSpan={5}>
                    No images remain in this dataset.
                  </td>
                </tr>
              ) : dataset.images.map((image) => (
                <tr key={image.id}>
                  <td>
                    <strong>{image.relativePath}</strong>
                    <span>{image.width && image.height ? `${image.width} × ${image.height}` : 'Dimensions pending'}</span>
                    {image.lastError ? <span className="row-error">{image.lastError}</span> : null}
                  </td>
                  <td>
                    <span className={`status-pill status-${image.processingState}`}>
                      {image.processingState}
                    </span>
                  </td>
                  <td>
                    <select
                      value={image.workflowLabel}
                      onChange={(event) => onUpdateLabel(image.id, event.target.value as WorkflowLabel)}
                    >
                      {workflowOptions.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{image.historyDepth} steps</td>
                  <td className="row-actions">
                    <Link
                      className={`link-button ${image.processingState !== 'ready' ? 'disabled-link' : ''}`}
                      to={`/datasets/${dataset.id}/images/${image.id}`}
                      aria-disabled={image.processingState !== 'ready'}
                      onClick={(event) => {
                        if (image.processingState !== 'ready') {
                          event.preventDefault()
                        }
                      }}
                    >
                      Open editor
                    </Link>
                    <button
                      className="secondary-button compact-button"
                      type="button"
                      onClick={() => onExportImage(image.id, image.relativePath)}
                      disabled={exportingId === image.id || removingId === image.id}
                    >
                      {exportingId === image.id ? 'Exporting…' : 'Export'}
                    </button>
                    <button
                      className="danger-button compact-button"
                      type="button"
                      onClick={() => onRemoveImage(image.id, image.relativePath)}
                      disabled={removingId === image.id}
                    >
                      {removingId === image.id ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
