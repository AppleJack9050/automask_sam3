import { startTransition, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { uploadEntries } from '../api'
import { collectDroppedEntries, inferDatasetName, normalizeInputFiles } from '../file-utils'
import type { UploadEntry, UploadProgressEntry } from '../types'

type SelectionSummaryProps = {
  entries: UploadEntry[]
  progress: UploadProgressEntry[]
}

function SelectionSummary({ entries, progress }: SelectionSummaryProps) {
  const progressMap = useMemo(
    () => new Map(progress.map((item) => [item.relativePath, item.progress])),
    [progress],
  )

  return (
    <div className="selection-panel">
      <div className="section-heading">
        <h2>Selected items</h2>
        <span>{entries.length} files ready</span>
      </div>
      <ul className="selection-list">
        {entries.slice(0, 14).map((entry) => (
          <li key={entry.relativePath}>
            <div>
              <strong>{entry.relativePath}</strong>
              <span>{Math.max(entry.file.size / 1024 / 1024, 0.01).toFixed(2)} MB</span>
            </div>
            <progress max={1} value={progressMap.get(entry.relativePath) ?? 0} />
          </li>
        ))}
      </ul>
      {entries.length > 14 ? (
        <p className="helper-text">Showing the first 14 items. The upload will include all {entries.length} files.</p>
      ) : null}
    </div>
  )
}

export function UploadPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const [entries, setEntries] = useState<UploadEntry[]>([])
  const [progress, setProgress] = useState<UploadProgressEntry[]>([])
  const [datasetName, setDatasetName] = useState('dataset')
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const applyEntries = (nextEntries: UploadEntry[]) => {
    setEntries(nextEntries)
    setProgress(nextEntries.map((entry) => ({ relativePath: entry.relativePath, progress: 0 })))
    setDatasetName(inferDatasetName(nextEntries))
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
      const dataset = await uploadEntries(entries, datasetName, setProgress)
      startTransition(() => {
        if (dataset.itemCount === 1 && dataset.images[0]?.processingState === 'ready') {
          navigate(`/datasets/${dataset.id}/images/${dataset.images[0].id}`)
          return
        }
        navigate(`/datasets/${dataset.id}`)
      })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="page upload-page">
      <div className="hero-panel">
        <p className="eyebrow">Local-first research workflow</p>
        <h1>Interactive background removal with a queue-safe SAM3 pipeline.</h1>
        <p className="lead">
          Drop a single image for direct editing or bring in a whole dataset to stage,
          label, process, inspect, and export with reproducible edit history.
        </p>
        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={openFilePicker}>
            Choose files
          </button>
          <button className="secondary-button" type="button" onClick={openFolderPicker}>
            Choose folder
          </button>
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
        onDrop={onDrop}
      >
        <div>
          <p className="dropzone-title">Drag images, RAW DNG files, folders, ZIP, or TAR.GZ here</p>
          <p className="helper-text">
            Supported inputs: JPG, PNG, WEBP, TIFF, DNG, ZIP, and TAR.GZ.
          </p>
        </div>
      </div>

      <div className="dataset-name-row">
        <label htmlFor="dataset-name">Dataset name</label>
        <input
          id="dataset-name"
          value={datasetName}
          onChange={(event) => setDatasetName(event.target.value)}
          placeholder="dataset"
        />
        <button
          className="primary-button"
          type="button"
          onClick={startUpload}
          disabled={entries.length === 0 || isUploading}
        >
          {isUploading ? 'Uploading…' : 'Upload to AutoMask'}
        </button>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}
      {entries.length > 0 ? <SelectionSummary entries={entries} progress={progress} /> : null}

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
