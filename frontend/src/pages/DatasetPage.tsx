import { startTransition, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import {
  deleteDatasetImage,
  exportDataset,
  exportImage,
  getDataset,
  getHealth,
  startDataset,
  updateWorkflowLabel,
} from '../api'
import { AlertBanner } from '../components/AlertBanner'
import { ConfirmationDialog } from '../components/ConfirmationDialog'
import { LoadingPanel } from '../components/LoadingPanel'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { usePolling } from '../hooks/usePolling'
import { DatasetFilters } from '../sections/dataset/DatasetFilters'
import { DatasetSummary } from '../sections/dataset/DatasetSummary'
import { DatasetTaskTable } from '../sections/dataset/DatasetTaskTable'
import type {
  ArchiveFormat,
  DatasetImage,
  ExportFormat,
  ExportMode,
  ProcessingState,
  WorkflowLabel,
} from '../types'
import {
  archiveOptions,
  exportModes,
  formatOptions,
  getDatasetExportReason,
  getStartProcessingReason,
} from '../workflow-ui'

type LocationFlashState = {
  flash?: string
} | null

export function DatasetPage() {
  const { datasetId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [flash, setFlash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png')
  const [exportMode, setExportMode] = useState<ExportMode>('transparent')
  const [archiveFormat, setArchiveFormat] = useState<ArchiveFormat>('zip')
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<DatasetImage | null>(null)
  const [search, setSearch] = useState('')
  const [processingFilter, setProcessingFilter] = useState<ProcessingState | 'all'>('all')
  const [labelFilter, setLabelFilter] = useState<WorkflowLabel | 'all'>('all')
  const {
    data: dataset,
    error: datasetError,
    isLoading,
    reload: reloadDataset,
    setData: setDataset,
  } = useAsyncResource(() => getDataset(datasetId), [datasetId])
  const { data: health } = useAsyncResource(() => getHealth(), [])

  useEffect(() => {
    const nextFlash = (location.state as LocationFlashState)?.flash
    if (!nextFlash) {
      return
    }
    setFlash(nextFlash)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  usePolling(Boolean(dataset?.summary.hasInFlightWork), 1600, async () => {
    if (!dataset) {
      return
    }
    const nextDataset = await getDataset(dataset.id)
    startTransition(() => setDataset(nextDataset))
  })

  const effectiveFormat =
    exportMode === 'transparent' && (exportFormat === 'jpg' || exportFormat === 'bmp')
      ? 'png'
      : exportFormat
  const appendUploadPath = `/?datasetId=${datasetId}`

  const filteredImages = useMemo(() => {
    if (!dataset) {
      return []
    }
    const searchValue = search.trim().toLowerCase()
    return dataset.images.filter((image) => {
      if (processingFilter !== 'all' && image.processingState !== processingFilter) {
        return false
      }
      if (labelFilter !== 'all' && image.workflowLabel !== labelFilter) {
        return false
      }
      if (searchValue && !image.relativePath.toLowerCase().includes(searchValue)) {
        return false
      }
      return true
    })
  }, [dataset, labelFilter, processingFilter, search])

  const firstReadyImage = dataset?.images.find((image) => image.actions.canOpenEditor) ?? null

  const onStart = async () => {
    if (!dataset) {
      return
    }
    try {
      setActionError(null)
      setIsStarting(true)
      const nextDataset = await startDataset(dataset.id)
      setDataset(nextDataset)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Failed to start dataset processing.')
    } finally {
      setIsStarting(false)
    }
  }

  const onUpdateLabel = async (imageId: string, workflowLabel: WorkflowLabel) => {
    if (!dataset) {
      return
    }
    try {
      setActionError(null)
      await updateWorkflowLabel(imageId, workflowLabel)
      const nextDataset = await getDataset(dataset.id)
      setDataset(nextDataset)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Failed to update the workflow label.')
    }
  }

  const onExportDataset = async () => {
    if (!dataset) {
      return
    }
    try {
      setActionError(null)
      setExportingId('dataset')
      await exportDataset(
        dataset.id,
        effectiveFormat,
        exportMode,
        archiveFormat,
        `${dataset.name}.${archiveFormat === 'zip' ? 'zip' : 'tar.gz'}`,
      )
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Dataset export failed.')
    } finally {
      setExportingId(null)
    }
  }

  const onExportImage = async (imageId: string, relativePath: string) => {
    try {
      setActionError(null)
      setExportingId(imageId)
      await exportImage(
        imageId,
        effectiveFormat,
        exportMode,
        relativePath.replace(/\.[^.]+$/, `.${effectiveFormat}`),
      )
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Image export failed.')
    } finally {
      setExportingId(null)
    }
  }

  const onConfirmRemoveImage = async () => {
    if (!dataset || !pendingRemoval) {
      return
    }
    try {
      setActionError(null)
      setRemovingId(pendingRemoval.id)
      const nextDataset = await deleteDatasetImage(dataset.id, pendingRemoval.id)
      setDataset(nextDataset)
      setPendingRemoval(null)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Failed to remove the image from the dataset.')
    } finally {
      setRemovingId(null)
    }
  }

  const primaryActionButton = (() => {
    if (!dataset) {
      return null
    }

    switch (dataset.actions.recommendedPrimaryAction) {
      case 'start_processing':
      case 'processing':
        return (
          <button
            className="primary-button"
            type="button"
            onClick={dataset.actions.recommendedPrimaryAction === 'start_processing' ? () => void onStart() : undefined}
            disabled={!dataset.actions.canStartProcessing || isStarting}
          >
            {isStarting ? 'Queueing…' : dataset.actions.recommendedPrimaryAction === 'processing' ? 'Processing…' : 'Start processing'}
          </button>
        )
      case 'review_ready':
        return firstReadyImage ? (
          <Link className="primary-button link-button-plain" to={`/datasets/${dataset.id}/images/${firstReadyImage.id}`}>
            Review ready image
          </Link>
        ) : null
      case 'export_dataset':
        return (
          <button
            className="primary-button"
            type="button"
            onClick={() => void onExportDataset()}
            disabled={!dataset.actions.canExportDataset || exportingId === 'dataset'}
          >
            {exportingId === 'dataset' ? 'Exporting…' : 'Export dataset'}
          </button>
        )
      case 'upload_more':
        return (
          <Link className="primary-button link-button-plain" to={appendUploadPath}>
            Add more data
          </Link>
        )
      default:
        return null
    }
  })()

  const actionReason = dataset
    ? dataset.actions.recommendedPrimaryAction === 'start_processing' ||
      dataset.actions.recommendedPrimaryAction === 'processing'
      ? getStartProcessingReason(dataset, health ?? null)
      : dataset.actions.recommendedPrimaryAction === 'export_dataset'
        ? getDatasetExportReason(dataset)
        : null
    : null

  if (isLoading && !dataset) {
    return <LoadingPanel title="Dataset loading" description="Reading dataset inventory and workflow summary…" />
  }

  if (!dataset) {
    return (
      <section className="page">
        <div className="panel">
          <h1>Dataset unavailable</h1>
          <p>{actionError ?? datasetError ?? 'The dataset could not be loaded.'}</p>
          <button className="secondary-button" type="button" onClick={() => void reloadDataset()}>
            Retry
          </button>
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
            {dataset.itemCount} staged items. Use the summary first, then filter the task list down to what needs attention.
          </p>
        </div>
      </div>

      {flash ? <AlertBanner kind="success" message={flash} /> : null}
      {actionError ? <AlertBanner kind="error" message={actionError} /> : null}
      {datasetError ? <AlertBanner kind="error" message={datasetError} /> : null}

      <DatasetSummary
        dataset={dataset}
        actionReason={actionReason}
        primaryAction={primaryActionButton}
        secondaryAction={
          <Link className="secondary-button link-button-plain" to={appendUploadPath}>
            Add more data
          </Link>
        }
      />

      <section className="export-card">
        <div className="section-heading">
          <h2>Dataset export</h2>
          <span>{dataset.actions.canExportDataset ? 'Ready when you are' : 'Currently unavailable'}</span>
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
            onClick={() => void onExportDataset()}
            disabled={!dataset.actions.canExportDataset || exportingId === 'dataset'}
          >
            {exportingId === 'dataset' ? 'Exporting…' : 'Download dataset'}
          </button>
        </div>
        {getDatasetExportReason(dataset) ? (
          <p className="helper-text action-reason">{getDatasetExportReason(dataset)}</p>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Task list</h2>
            <p className="helper-text">Filters are client-side. Labels stay manual and independent from model processing.</p>
          </div>
          <span>{filteredImages.length} shown</span>
        </div>

        <DatasetFilters
          search={search}
          processingState={processingFilter}
          workflowLabel={labelFilter}
          onSearchChange={setSearch}
          onProcessingStateChange={setProcessingFilter}
          onWorkflowLabelChange={setLabelFilter}
        />

        <DatasetTaskTable
          datasetId={dataset.id}
          images={filteredImages}
          isEmptyDataset={dataset.images.length === 0}
          exportingId={exportingId}
          removingId={removingId}
          onUpdateLabel={(imageId, workflowLabel) => void onUpdateLabel(imageId, workflowLabel)}
          onExportImage={(imageId, relativePath) => void onExportImage(imageId, relativePath)}
          onRemoveImage={(imageId) => {
            const image = dataset.images.find((item) => item.id === imageId)
            if (image) {
              setPendingRemoval(image)
            }
          }}
        />
      </section>

      <ConfirmationDialog
        open={Boolean(pendingRemoval)}
        title="Remove image from task list?"
        description={
          pendingRemoval
            ? `${pendingRemoval.relativePath} will be removed from this dataset, along with its saved mask and history snapshots.`
            : ''
        }
        confirmLabel="Remove image"
        isWorking={Boolean(removingId)}
        onConfirm={() => void onConfirmRemoveImage()}
        onCancel={() => {
          if (!removingId) {
            setPendingRemoval(null)
          }
        }}
      />
    </section>
  )
}
