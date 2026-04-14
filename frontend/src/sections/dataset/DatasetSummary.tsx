import { ActionBar } from '../../components/ActionBar'
import { StatusBadge } from '../../components/StatusBadge'
import type { Dataset } from '../../types'
import { formatWorkflowLabel, getPrimaryActionCopy } from '../../workflow-ui'

type DatasetSummaryProps = {
  dataset: Dataset
  actionReason: string | null
  primaryAction: React.ReactNode
  secondaryAction?: React.ReactNode
}

export function DatasetSummary({
  dataset,
  actionReason,
  primaryAction,
  secondaryAction,
}: DatasetSummaryProps) {
  const primaryActionCopy = getPrimaryActionCopy(dataset.actions.recommendedPrimaryAction)

  return (
    <section className="panel dataset-summary">
      <ActionBar
        title={primaryActionCopy.title}
        description={primaryActionCopy.description}
        aside={
          <div className="summary-meta">
            <span><strong>Source:</strong> {dataset.sourceType}</span>
            <span><strong>Queue:</strong> {dataset.summary.hasInFlightWork ? 'active' : 'idle'}</span>
            <span><strong>Root:</strong> {dataset.rootPath}</span>
          </div>
        }
        actions={
          <>
            {primaryAction}
            {secondaryAction}
          </>
        }
      />

      {actionReason ? <p className="helper-text action-reason">{actionReason}</p> : null}

      <div className="summary-grid">
        <div className="summary-card">
          <div className="section-heading">
            <h3>Processing states</h3>
            <StatusBadge state={dataset.summary.hasInFlightWork ? 'preparing' : 'ready'} />
          </div>
          <ul className="count-list">
            {Object.entries(dataset.summary.processingCounts).map(([state, count]) => (
              <li key={state}>
                <span>{state}</span>
                <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div className="summary-card">
          <div className="section-heading">
            <h3>Manual labels</h3>
            <span>{dataset.itemCount} total</span>
          </div>
          <ul className="count-list">
            {Object.entries(dataset.summary.labelCounts).map(([label, count]) => (
              <li key={label}>
                <span>{formatWorkflowLabel(label as keyof typeof dataset.summary.labelCounts)}</span>
                <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
