import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import {
  commitPreview,
  exportImage,
  getDataset,
  getEditorState,
  redoEdit,
  restoreEdit,
  undoEdit,
} from '../api'
import { AlertBanner } from '../components/AlertBanner'
import { LoadingPanel } from '../components/LoadingPanel'
import { StatusBadge } from '../components/StatusBadge'
import { useAsyncResource } from '../hooks/useAsyncResource'
import { useEditorInteractions } from '../hooks/useEditorInteractions'
import { usePolling } from '../hooks/usePolling'
import { EditorControls } from '../sections/editor/EditorControls'
import { EditorSidebar } from '../sections/editor/EditorSidebar'
import { EditorStage } from '../sections/editor/EditorStage'
import type { ExportFormat, ExportMode } from '../types'

type LocationFlashState = {
  flash?: string
} | null

export function EditorPage() {
  const { datasetId = '', imageId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [flash, setFlash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [exportMode, setExportMode] = useState<ExportMode>('transparent')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png')
  const [isWorking, setIsWorking] = useState(false)
  const {
    data: dataset,
    error: datasetError,
    isLoading: isLoadingDataset,
    reload: reloadDataset,
    setData: setDataset,
  } = useAsyncResource(() => getDataset(datasetId), [datasetId])
  const {
    data: editor,
    error: editorError,
    isLoading: isLoadingEditor,
    reload: reloadEditor,
    setData: setEditor,
  } = useAsyncResource(() => getEditorState(imageId), [imageId])
  const interactions = useEditorInteractions(editor, imageId, setActionError)

  useEffect(() => {
    const nextFlash = (location.state as LocationFlashState)?.flash
    if (!nextFlash) {
      return
    }
    setFlash(nextFlash)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  usePolling(Boolean(dataset?.summary.hasInFlightWork || (editor && editor.processingState !== 'ready')), 1600, async () => {
    const [nextDataset, nextEditor] = await Promise.all([
      getDataset(datasetId),
      getEditorState(imageId),
    ])
    setDataset(nextDataset)
    setEditor(nextEditor)
  })

  const effectiveFormat =
    exportMode === 'transparent' && (exportFormat === 'jpg' || exportFormat === 'bmp')
      ? 'png'
      : exportFormat

  const currentImageIndex = useMemo(
    () => dataset?.images.findIndex((image) => image.id === imageId) ?? -1,
    [dataset, imageId],
  )

  const refreshDatasetAndEditor = async () => {
    const [nextDataset, nextEditor] = await Promise.all([
      getDataset(datasetId),
      getEditorState(imageId),
    ])
    setDataset(nextDataset)
    setEditor(nextEditor)
  }

  const onMaskAction = async (mode: 'mask' | 'unmask') => {
    if (!interactions.preview || !editor) {
      return
    }

    try {
      setActionError(null)
      setIsWorking(true)
      const nextEditor = await commitPreview(imageId, mode, interactions.preview.previewId, interactions.preview.prompt)
      setEditor(nextEditor)
      interactions.resetAfterMutation()
      const nextDataset = await getDataset(datasetId)
      setDataset(nextDataset)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Failed to commit the preview.')
    } finally {
      setIsWorking(false)
    }
  }

  const runEditorAction = async (action: 'undo' | 'redo' | 'restore') => {
    try {
      setActionError(null)
      setIsWorking(true)
      const nextEditor =
        action === 'undo'
          ? await undoEdit(imageId)
          : action === 'redo'
            ? await redoEdit(imageId)
            : await restoreEdit(imageId)
      setEditor(nextEditor)
      interactions.resetAfterMutation()
      const nextDataset = await getDataset(datasetId)
      setDataset(nextDataset)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Failed to update the editor state.')
    } finally {
      setIsWorking(false)
    }
  }

  const onExportImage = async () => {
    if (!editor) {
      return
    }
    try {
      setActionError(null)
      setIsWorking(true)
      await exportImage(
        editor.id,
        effectiveFormat,
        exportMode,
        editor.relativePath.replace(/\.[^.]+$/, `.${effectiveFormat}`),
      )
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Failed to export the current image.')
    } finally {
      setIsWorking(false)
    }
  }

  if ((isLoadingDataset || isLoadingEditor) && (!dataset || !editor)) {
    return <LoadingPanel title="Editor loading" description="Preparing dataset context and editor state…" />
  }

  if (!dataset || !editor) {
    return (
      <section className="page">
        <div className="panel">
          <h1>Editor unavailable</h1>
          <p>{actionError ?? datasetError ?? editorError ?? 'The editor state could not be loaded.'}</p>
          <div className="hero-actions">
            <button className="secondary-button" type="button" onClick={() => void reloadDataset()}>
              Retry dataset
            </button>
            <button className="secondary-button" type="button" onClick={() => void reloadEditor()}>
              Retry editor
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="page editor-page">
      <EditorSidebar dataset={dataset} editor={editor} />

      <div className="editor-main">
        <div className="page-header">
          <div>
            <p className="eyebrow">Interactive editor</p>
            <h1>{editor.relativePath}</h1>
            <p className="lead">
              {editor.width} × {editor.height} pixels. History depth {editor.historyDepth}/10.
            </p>
          </div>
          <div className="toolbar-card">
            <StatusBadge state={editor.processingState} />
            <span>Image {currentImageIndex + 1} of {dataset.images.length}</span>
          </div>
        </div>

        {flash ? <AlertBanner kind="success" message={flash} /> : null}
        {actionError ? <AlertBanner kind="error" message={actionError} /> : null}
        {datasetError ? <AlertBanner kind="error" message={datasetError} /> : null}
        {editorError ? <AlertBanner kind="error" message={editorError} /> : null}

        <EditorControls
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          isWorking={isWorking}
          showCommittedMask={interactions.showCommittedMask}
          showOriginalOnly={interactions.showOriginalOnly}
          exportMode={exportMode}
          effectiveFormat={effectiveFormat}
          onUndo={() => void runEditorAction('undo')}
          onRedo={() => void runEditorAction('redo')}
          onRestore={() => void runEditorAction('restore')}
          onToggleCommittedMask={() => interactions.setShowCommittedMask((value) => !value)}
          onToggleOriginalOnly={() => interactions.setShowOriginalOnly((value) => !value)}
          onExportModeChange={setExportMode}
          onExportFormatChange={setExportFormat}
          onExport={() => void onExportImage()}
        />

        {editor.processingState !== 'ready' ? (
          <div className="panel">
            <h2>Image not prepared yet</h2>
            <p>
              This image is still waiting on the sequential preparation step. The page will refresh
              automatically while the dataset queue is active.
            </p>
            <button className="secondary-button" type="button" onClick={() => void refreshDatasetAndEditor()}>
              Refresh now
            </button>
          </div>
        ) : (
          <EditorStage
            editor={editor}
            imageUrlToken={interactions.imageUrlToken}
            viewport={interactions.viewport}
            preview={interactions.preview}
            contextMenu={interactions.contextMenu}
            stageRef={interactions.stageRef}
            menuRef={interactions.menuRef}
            imageRef={interactions.imageRef}
            committedMaskRef={interactions.committedMaskRef}
            previewMaskRef={interactions.previewMaskRef}
            onImageLoad={interactions.updateViewport}
            onMouseMove={interactions.handleMouseMove}
            onMouseLeave={interactions.handleMouseLeave}
            onContextMenu={interactions.handleContextMenu}
            onMask={() => void onMaskAction('mask')}
            onUnmask={() => void onMaskAction('unmask')}
            onDismissMenu={interactions.dismissContextMenu}
          />
        )}
      </div>
    </section>
  )
}
