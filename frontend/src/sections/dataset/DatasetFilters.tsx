import type { ProcessingState, WorkflowLabel } from '../../types'
import { formatProcessingState, formatWorkflowLabel, processingStateOptions, workflowOptions } from '../../workflow-ui'

type DatasetFiltersProps = {
  search: string
  processingState: ProcessingState | 'all'
  workflowLabel: WorkflowLabel | 'all'
  onSearchChange: (value: string) => void
  onProcessingStateChange: (value: ProcessingState | 'all') => void
  onWorkflowLabelChange: (value: WorkflowLabel | 'all') => void
}

export function DatasetFilters({
  search,
  processingState,
  workflowLabel,
  onSearchChange,
  onProcessingStateChange,
  onWorkflowLabelChange,
}: DatasetFiltersProps) {
  return (
    <div className="toolbar-grid filters-grid">
      <label>
        Search filenames
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by relative path"
        />
      </label>
      <label>
        Processing state
        <select
          value={processingState}
          onChange={(event) => onProcessingStateChange(event.target.value as ProcessingState | 'all')}
        >
          {processingStateOptions.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? 'All states' : formatProcessingState(option)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Workflow label
        <select
          value={workflowLabel}
          onChange={(event) => onWorkflowLabelChange(event.target.value as WorkflowLabel | 'all')}
        >
          <option value="all">All labels</option>
          {workflowOptions.map((option) => (
            <option key={option} value={option}>
              {formatWorkflowLabel(option)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
