import type { EditorState, PreviewResponse } from '../../types'

type EditorStageProps = {
  editor: EditorState
  imageUrlToken: number
  viewport: { width: number; height: number }
  preview: PreviewResponse | null
  contextMenu: {
    left: number
    top: number
  } | null
  stageRef: React.RefObject<HTMLDivElement | null>
  menuRef: React.RefObject<HTMLDivElement | null>
  imageRef: React.RefObject<HTMLImageElement | null>
  committedMaskRef: React.RefObject<HTMLCanvasElement | null>
  previewMaskRef: React.RefObject<HTMLCanvasElement | null>
  onImageLoad: () => void
  onMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave: () => void
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void
  onMask: () => void
  onUnmask: () => void
  onDismissMenu: () => void
}

export function EditorStage({
  editor,
  imageUrlToken,
  viewport,
  preview,
  contextMenu,
  stageRef,
  menuRef,
  imageRef,
  committedMaskRef,
  previewMaskRef,
  onImageLoad,
  onMouseMove,
  onMouseLeave,
  onContextMenu,
  onMask,
  onUnmask,
  onDismissMenu,
}: EditorStageProps) {
  return (
    <div className="editor-stage-shell panel">
      <div
        ref={stageRef}
        className="editor-stage"
        style={{ width: viewport.width || undefined }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onContextMenu={onContextMenu}
      >
        <img
          key={`${editor.originalUrl}-${imageUrlToken}`}
          ref={imageRef}
          className="editor-image"
          src={`${editor.originalUrl}?v=${imageUrlToken}`}
          alt={editor.relativePath}
          onLoad={onImageLoad}
        />
        <canvas ref={committedMaskRef} className="editor-canvas" />
        <canvas ref={previewMaskRef} className="editor-canvas" />
        {contextMenu && preview ? (
          <div
            ref={menuRef}
            className="context-menu"
            style={{ left: contextMenu.left, top: contextMenu.top }}
          >
            <button type="button" onClick={onMask}>
              Mask
            </button>
            <button type="button" onClick={onUnmask}>
              Unmask
            </button>
            <button type="button" onClick={onDismissMenu}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      <div className="helper-bar">
        <span>Hover for a debounced preview.</span>
        <span>Right-click to lock the prompt and choose the edit action.</span>
        <span>Left-click elsewhere to close the menu and continue.</span>
      </div>
    </div>
  )
}
