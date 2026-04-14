type ConfirmationDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  isWorking?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  isWorking = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-copy">
          <h2 id="confirmation-title">{title}</h2>
          <p>{description}</p>
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={isWorking}>
            {cancelLabel}
          </button>
          <button className="danger-button" type="button" onClick={onConfirm} disabled={isWorking}>
            {isWorking ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
