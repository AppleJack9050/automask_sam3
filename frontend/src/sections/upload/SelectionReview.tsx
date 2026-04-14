import type { UploadEntry, UploadProgressEntry } from '../../types'
import { formatBytes, summarizeSelectionTypes } from '../../workflow-ui'

type SelectionReviewProps = {
  entries: UploadEntry[]
  progress: UploadProgressEntry[]
  datasetName: string
  isUploading: boolean
  onClear: () => void
}

export function SelectionReview({
  entries,
  progress,
  datasetName,
  isUploading,
  onClear,
}: SelectionReviewProps) {
  const progressMap = new Map(progress.map((item) => [item.relativePath, item.progress]))
  const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0)
  const inputTypes = summarizeSelectionTypes(entries)
  const completed = progress.filter((item) => item.progress >= 1).length

  return (
    <section className="selection-panel">
      <div className="section-heading">
        <div>
          <h2>Selection review</h2>
          <p className="helper-text">
            {datasetName || 'dataset'} will include {entries.length} staged item{entries.length === 1 ? '' : 's'}.
          </p>
        </div>
        <button className="secondary-button compact-button" type="button" onClick={onClear} disabled={isUploading}>
          Clear selection
        </button>
      </div>

      <div className="selection-metrics">
        <div className="metric-card">
          <span className="metric-label">Files</span>
          <strong>{entries.length}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Total size</span>
          <strong>{formatBytes(totalBytes)}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Detected inputs</span>
          <strong>{inputTypes.join(', ')}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">Upload progress</span>
          <strong>{isUploading ? `${completed}/${entries.length}` : 'Waiting to start'}</strong>
        </div>
      </div>

      <ul className="selection-list">
        {entries.slice(0, 12).map((entry) => (
          <li key={entry.relativePath}>
            <div>
              <strong>{entry.relativePath}</strong>
              <span>{formatBytes(entry.file.size)}</span>
            </div>
            <progress max={1} value={progressMap.get(entry.relativePath) ?? 0} />
          </li>
        ))}
      </ul>

      {entries.length > 12 ? (
        <p className="helper-text">
          Showing the first 12 staged items. The upload will still include all {entries.length} files.
        </p>
      ) : null}
    </section>
  )
}
