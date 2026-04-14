import { formatProcessingState } from '../workflow-ui'
import type { ProcessingState } from '../types'

type StatusBadgeProps = {
  state: ProcessingState
}

export function StatusBadge({ state }: StatusBadgeProps) {
  return <span className={`status-pill status-${state}`}>{formatProcessingState(state)}</span>
}
