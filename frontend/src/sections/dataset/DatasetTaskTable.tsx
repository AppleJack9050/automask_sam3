import { Link } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { StatusBadge } from '../../components/StatusBadge'
import type { DatasetImage, WorkflowLabel } from '../../types'
import { formatWorkflowLabel, workflowOptions } from '../../workflow-ui'

type DatasetTaskTableProps = {
  datasetId: string
  images: DatasetImage[]
  isEmptyDataset: boolean
  exportingId: string | null
  removingId: string | null
  onUpdateLabel: (imageId: string, workflowLabel: WorkflowLabel) => void
  onExportImage: (imageId: string, relativePath: string) => void
  onRemoveImage: (imageId: string) => void
}

export function DatasetTaskTable({
  datasetId,
  images,
  isEmptyDataset,
  exportingId,
  removingId,
  onUpdateLabel,
  onExportImage,
  onRemoveImage,
}: DatasetTaskTableProps) {
  if (isEmptyDataset) {
    return (
      <EmptyState
        title="This dataset is empty now"
        description="Add more source files to continue this same task list, or keep this dataset as a cleared workspace."
      />
    )
  }

  if (images.length === 0) {
    return (
      <EmptyState
        title="No images match the current filters"
        description="Try clearing the search box or broadening the state and label filters."
      />
    )
  }

  return (
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
          {images.map((image) => (
            <tr key={image.id}>
              <td>
                <strong>{image.relativePath}</strong>
                <span>
                  {image.width && image.height ? `${image.width} × ${image.height}` : 'Dimensions pending'}
                </span>
                {image.lastError ? <span className="row-error">{image.lastError}</span> : null}
              </td>
              <td>
                <StatusBadge state={image.processingState} />
              </td>
              <td>
                <label className="sr-only" htmlFor={`label-${image.id}`}>
                  Workflow label for {image.relativePath}
                </label>
                <select
                  id={`label-${image.id}`}
                  value={image.workflowLabel}
                  onChange={(event) => onUpdateLabel(image.id, event.target.value as WorkflowLabel)}
                >
                  {workflowOptions.map((label) => (
                    <option key={label} value={label}>
                      {formatWorkflowLabel(label)}
                    </option>
                  ))}
                </select>
              </td>
              <td>{image.historyDepth} steps</td>
              <td className="row-actions">
                <Link
                  className={`link-button ${!image.actions.canOpenEditor ? 'disabled-link' : ''}`}
                  to={`/datasets/${datasetId}/images/${image.id}`}
                  aria-disabled={!image.actions.canOpenEditor}
                  onClick={(event) => {
                    if (!image.actions.canOpenEditor) {
                      event.preventDefault()
                    }
                  }}
                >
                  {image.actions.canOpenEditor ? 'Open editor' : 'Waiting'}
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
                  onClick={() => onRemoveImage(image.id)}
                  disabled={!image.actions.canRemove || removingId === image.id}
                >
                  {removingId === image.id ? 'Removing…' : 'Remove'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
