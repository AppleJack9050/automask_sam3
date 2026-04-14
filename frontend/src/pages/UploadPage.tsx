import { startTransition, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { getDataset, getHealth, uploadEntries } from '../api'
import { AlertBanner } from '../components/AlertBanner'
import { ActionBar } from '../components/ActionBar'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { collectDroppedEntries, inferDatasetName, normalizeInputFiles } from '../file-utils'
import { BackendReadinessCard } from '../sections/upload/BackendReadinessCard'
import { SelectionReview } from '../sections/upload/SelectionReview'
import { LoadingPanel } from '../components/LoadingPanel'
import type { Dataset, UploadEntry, UploadProgressEntry } from '../types'

export function UploadPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const appendDatasetId = searchParams.get('datasetId') ?? ''
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const [entries, setEntries] = useState<UploadEntry[]>([])
  const [progress, setProgress] = useState<UploadProgressEntry[]>([])
  const [datasetName, setDatasetName] = useState('dataset')
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const { data: health, isLoading: isLoadingHealth, reload: reloadHealth } = useAsyncResource(
    () => getHealth(),
    [],
  )
  const {
    data: appendDataset,
    error: appendDatasetError,
    isLoading: isLoadingAppendDataset,
  } = useAsyncResource<Dataset | null>(
    () => (appendDatasetId ? getDataset(appendDatasetId) : Promise.resolve(null)),
    [appendDatasetId],
  )

  useEffect(() => {
    if (appendDataset) {
      setDatasetName(appendDataset.name)
    }
  }, [appendDataset])

  const isAppending = Boolean(appendDatasetId)

  const applyEntries = (nextEntries: UploadEntry[]) => {
    setEntries(nextEntries)
    setProgress(nextEntries.map((entry) => ({ relativePath: entry.relativePath, progress: 0 })))
    if (!isAppending) {
      setDatasetName(inferDatasetName(nextEntries))
    }
    setError(null)
  }

  const clearSelection = () => {
    setEntries([])
    setProgress([])
    setError(null)
  }

  const onFilesPicked = (files: FileList | null) => {
    const nextEntries = normalizeInputFiles(files)
    if (nextEntries.length === 0) {
      return
    }
    applyEntries(nextEntries)
  }

  const openFolderPicker = () => {
    const input = folderInputRef.current
    if (!input) {
      return
    }
    input.setAttribute('webkitdirectory', '')
    input.click()
  }

  const openFilePicker = () => {
    fileInputRef.current?.click()
  }

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const droppedEntries = await collectDroppedEntries(event.dataTransfer.items)
    if (droppedEntries.length === 0) {
      setError('No readable images or archives were detected in the drop payload.')
      return
    }
    applyEntries(droppedEntries)
  }

  const startUpload = async () => {
    if (entries.length === 0 || isUploading) {
      return
    }

    try {
      setError(null)
      setIsUploading(true)
      const dataset = await uploadEntries(entries, datasetName, setProgress, {
        datasetId: appendDatasetId || undefined,
      })
      const readySingleImage =
        !isAppending && dataset.itemCount === 1 && Boolean(dataset.images[0]?.actions.canOpenEditor)

      const pathname = readySingleImage
        ? `/datasets/${dataset.id}/images/${dataset.images[0].id}`
        : `/datasets/${dataset.id}`
      const flash = isAppending
        ? `Added ${entries.length} item${entries.length === 1 ? '' : 's'} to ${dataset.name}. New files now appear in this task list.`
        : readySingleImage
          ? 'Upload complete. The editor is open, so you can hover for previews and right-click to commit Mask or Unmask.'
          : 'Upload complete. Review the dataset summary, start processing when needed, and open ready images from the task list.'

      startTransition(() => {
        navigate(pathname, { state: { flash } })
      })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  if (isAppending && isLoadingAppendDataset && !appendDataset) {
    return <LoadingPanel title="Task list loading" description="Loading the dataset you want to add more data to…" />
  }

  if (isAppending && !appendDataset) {
    return (
      <section className="page">
        <div className="panel">
          <h1>Dataset unavailable</h1>
          <p>{appendDatasetError ?? 'The existing dataset could not be found.'}</p>
          <Link className="secondary-button link-button-plain" to="/">
            Start a new upload instead
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="page upload-page">
      <div className="upload-column">
        <div className="hero-panel">
          <p className="eyebrow">Local-first research workflow</p>
          <h1>
            {isAppending
              ? 'Add more files to the current task list without starting over.'
              : 'Interactive background removal with a calmer upload-to-editor journey.'}
          </h1>
          <p className="lead">
            {isAppending
              ? `New images and archives will be merged into ${appendDataset?.name}, keeping the same dataset summary, labels, and task history for existing items.`
              : 'Stage a single image for direct review or build a full dataset with clearer next steps, safer queue handling, and export-friendly task tracking.'}
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={openFilePicker}>
              Choose files
            </button>
            <button className="secondary-button" type="button" onClick={openFolderPicker}>
              Choose folder
            </button>
            {appendDataset ? (
              <Link className="secondary-button link-button-plain" to={`/datasets/${appendDataset.id}`}>
                Back to dataset
              </Link>
            ) : null}
          </div>
        </div>

        <div
          className={`dropzone ${isDragging ? 'dragging' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault()
            setIsDragging(false)
          }}
          onDrop={(event) => void onDrop(event)}
        >
          <div>
            <p className="dropzone-title">Drag images, folders, ZIP, or TAR.GZ here</p>
            <p className="helper-text">
              Supported inputs: JPG, PNG, WEBP, TIFF, DNG, ZIP, and TAR.GZ.
            </p>
          </div>
        </div>

        <section className="panel upload-setup-panel">
          <ActionBar
            title={isAppending ? 'Review the selection, then add it to the existing task list' : 'Name the dataset and start when you are ready'}
            description={
              isAppending
                ? 'The existing dataset name stays the same. Added files will appear in the current task list after upload.'
                : 'Single ready images open the editor automatically. Larger uploads land in the dataset workspace with summary guidance.'
            }
            actions={
              <button
                className="primary-button"
                type="button"
                onClick={startUpload}
                disabled={entries.length === 0 || isUploading}
              >
                {isUploading ? 'Uploading…' : isAppending ? 'Add to task list' : 'Upload to AutoMask'}
              </button>
            }
          />
          {isAppending ? (
            <div className="dataset-name-row">
              <label>
                Existing dataset
                <input value={datasetName} readOnly />
              </label>
            </div>
          ) : (
            <div className="dataset-name-row">
              <label htmlFor="dataset-name">
                Dataset name
                <input
                  id="dataset-name"
                  value={datasetName}
                  onChange={(event) => setDatasetName(event.target.value)}
                  placeholder="dataset"
                />
              </label>
            </div>
          )}
        </section>

        {appendDataset ? (
          <AlertBanner
            kind="info"
            message={`Adding data to ${appendDataset.name}. Existing images stay in place; new files will be appended to the same task list.`}
          />
        ) : null}
        {error ? <AlertBanner kind="error" message={error} /> : null}
        {entries.length > 0 ? (
          <SelectionReview
            entries={entries}
            progress={progress}
            datasetName={datasetName}
            isUploading={isUploading}
            onClear={clearSelection}
          />
        ) : null}
      </div>

      <div className="upload-column">
        <BackendReadinessCard
          health={health}
          isLoading={isLoadingHealth}
          onRetry={() => void reloadHealth()}
        />
      </div>

      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.tif,.tiff,.dng,.zip,.tar.gz,.tgz"
        multiple
        onChange={(event) => onFilesPicked(event.target.files)}
      />
      <input
        ref={folderInputRef}
        hidden
        type="file"
        multiple
        onChange={(event) => onFilesPicked(event.target.files)}
      />
    </section>
  )
}
