import type { ExportFormat, ExportMode } from '../../types'
import { exportModes, formatOptions } from '../../workflow-ui'

type EditorControlsProps = {
  canUndo: boolean
  canRedo: boolean
  isWorking: boolean
  showCommittedMask: boolean
  showOriginalOnly: boolean
  exportMode: ExportMode
  effectiveFormat: ExportFormat
  onUndo: () => void
  onRedo: () => void
  onRestore: () => void
  onToggleCommittedMask: () => void
  onToggleOriginalOnly: () => void
  onExportModeChange: (value: ExportMode) => void
  onExportFormatChange: (value: ExportFormat) => void
  onExport: () => void
}

export function EditorControls({
  canUndo,
  canRedo,
  isWorking,
  showCommittedMask,
  showOriginalOnly,
  exportMode,
  effectiveFormat,
  onUndo,
  onRedo,
  onRestore,
  onToggleCommittedMask,
  onToggleOriginalOnly,
  onExportModeChange,
  onExportFormatChange,
  onExport,
}: EditorControlsProps) {
  return (
    <div className="control-groups">
      <section className="panel control-card">
        <div className="section-heading">
          <h2>Edit</h2>
          <span>History-aware changes</span>
        </div>
        <div className="toolbar-grid editor-toolbar">
          <button className="secondary-button" type="button" onClick={onUndo} disabled={!canUndo || isWorking}>
            Undo
          </button>
          <button className="secondary-button" type="button" onClick={onRedo} disabled={!canRedo || isWorking}>
            Redo
          </button>
          <button className="secondary-button" type="button" onClick={onRestore} disabled={isWorking}>
            Restore original
          </button>
        </div>
      </section>

      <section className="panel control-card">
        <div className="section-heading">
          <h2>View</h2>
          <span>Preview how the editor is interpreting the image</span>
        </div>
        <div className="toolbar-grid editor-toolbar">
          <button className="secondary-button" type="button" onClick={onToggleCommittedMask}>
            {showCommittedMask ? 'Hide mask' : 'Show mask'}
          </button>
          <button className="secondary-button" type="button" onClick={onToggleOriginalOnly}>
            {showOriginalOnly ? 'Show overlays' : 'View original'}
          </button>
        </div>
        <p className="helper-text">
          Hover to request a preview. Right-click a live preview to keep the prompt fixed and choose Mask or Unmask.
        </p>
      </section>

      <section className="panel control-card">
        <div className="section-heading">
          <h2>Export</h2>
          <span>Download the current image in the format you need</span>
        </div>
        <div className="toolbar-grid editor-toolbar">
          <label>
            Mode
            <select value={exportMode} onChange={(event) => onExportModeChange(event.target.value as ExportMode)}>
              {exportModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label>
            Format
            <select
              value={effectiveFormat}
              onChange={(event) => onExportFormatChange(event.target.value as ExportFormat)}
            >
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
          <button className="primary-button" type="button" onClick={onExport} disabled={isWorking}>
            {isWorking ? 'Working…' : 'Export image'}
          </button>
        </div>
      </section>
    </div>
  )
}
