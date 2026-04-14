import { AlertBanner } from '../../components/AlertBanner'
import type { HealthStatus } from '../../types'

type BackendReadinessCardProps = {
  health: HealthStatus | null
  isLoading: boolean
  onRetry: () => void
}

export function BackendReadinessCard({
  health,
  isLoading,
  onRetry,
}: BackendReadinessCardProps) {
  const title = isLoading
    ? 'Checking backend readiness'
    : health?.ready
      ? 'Backend is ready for interactive masking'
      : 'Backend needs attention before interactive masking'

  return (
    <section className="panel readiness-card">
      <div className="section-heading">
        <h2>{title}</h2>
        <button className="secondary-button compact-button" type="button" onClick={onRetry}>
          Refresh
        </button>
      </div>
      <p className="helper-text">
        AutoMask uses the backend health endpoint to decide whether SAM3 previewing is ready
        before you spend time uploading a dataset.
      </p>
      {health ? (
        <div className="readiness-meta">
          <span><strong>Backend:</strong> {health.backend}</span>
          <span><strong>Device:</strong> {health.device}</span>
          <span><strong>Status:</strong> {health.ready ? 'ready' : 'needs setup'}</span>
        </div>
      ) : null}
      {!isLoading && health && !health.ready ? (
        <>
          <AlertBanner kind="error" message={health.message ?? 'The model backend is not ready.'} />
          <div className="setup-note">
            <p>Typical local restart command:</p>
            <code>
              AUTOMASK_MODEL_BACKEND=sam3 AUTOMASK_MODEL_DEVICE=cuda uv run --project backend uvicorn app.main:app --reload
            </code>
          </div>
        </>
      ) : null}
      {!isLoading && health?.ready ? (
        <AlertBanner
          kind="success"
          message="Single-image uploads can open the editor directly, and multi-image datasets can be queued right away."
        />
      ) : null}
    </section>
  )
}
