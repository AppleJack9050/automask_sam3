import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  commitPreview,
  exportImage,
  getDataset,
  getEditorState,
  redoEdit,
  requestPreview,
  restoreEdit,
  undoEdit,
} from '../api'
import type { Dataset, EditorState, ExportFormat, ExportMode, PreviewResponse } from '../types'

const exportModes: ExportMode[] = ['transparent', 'binary_mask', 'overlay']
const exportFormats: ExportFormat[] = ['png', 'jpg', 'bmp', 'tiff']
const PREVIEW_DEBOUNCE_MS = 90
const PREVIEW_MIN_DISTANCE = 18

type ContextMenuState = {
  left: number
  top: number
  x: number
  y: number
} | null

function decodeMaskData(maskBase64: string) {
  return `data:image/png;base64,${maskBase64}`
}

function useCanvasMask() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const drawMask = async (
    width: number,
    height: number,
    maskBase64: string | null | undefined,
    color: [number, number, number],
    alpha: number,
    visible: boolean,
  ) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)
    if (!maskBase64 || !visible) {
      return
    }

    const image = new Image()
    image.src = decodeMaskData(maskBase64)
    await image.decode()
    context.drawImage(image, 0, 0, width, height)
    const imageData = context.getImageData(0, 0, width, height)
    for (let offset = 0; offset < imageData.data.length; offset += 4) {
      const value = imageData.data[offset]
      imageData.data[offset] = color[0]
      imageData.data[offset + 1] = color[1]
      imageData.data[offset + 2] = color[2]
      imageData.data[offset + 3] = Math.round((value / 255) * alpha * 255)
    }
    context.putImageData(imageData, 0, 0)
  }

  return { canvasRef, drawMask }
}

export function EditorPage() {
  const { datasetId = '', imageId = '' } = useParams()
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [showCommittedMask, setShowCommittedMask] = useState(true)
  const [showOriginalOnly, setShowOriginalOnly] = useState(false)
  const [exportMode, setExportMode] = useState<ExportMode>('transparent')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png')
  const [isWorking, setIsWorking] = useState(false)
  const [imageUrlToken, setImageUrlToken] = useState(0)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const stageRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const previewAbortRef = useRef<AbortController | null>(null)
  const requestCounterRef = useRef(0)
  const lastQueuedPointRef = useRef<{ x: number; y: number } | null>(null)
  const { canvasRef: committedMaskRef, drawMask: drawCommittedMask } = useCanvasMask()
  const { canvasRef: previewMaskRef, drawMask: drawPreviewMask } = useCanvasMask()

  useEffect(() => {
    if (!datasetId || !imageId) {
      return
    }
    let active = true
    Promise.all([getDataset(datasetId), getEditorState(imageId)])
      .then(([nextDataset, nextEditor]) => {
        if (!active) {
          return
        }
        setDataset(nextDataset)
        setEditor(nextEditor)
        setError(null)
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load the editor.')
        }
      })
    return () => {
      active = false
    }
  }, [datasetId, imageId])

  useEffect(() => {
    if (!editor) {
      return
    }
    drawCommittedMask(
      editor.width,
      editor.height,
      editor.committedMaskPngBase64,
      [0, 0, 0],
      1,
      showCommittedMask && !showOriginalOnly,
    )
  }, [drawCommittedMask, editor, imageUrlToken, showCommittedMask, showOriginalOnly])

  useEffect(() => {
    if (!editor) {
      return
    }
    drawPreviewMask(
      editor.width,
      editor.height,
      preview?.maskPngBase64,
      [57, 206, 163],
      0.4,
      Boolean(preview) && !showOriginalOnly,
    )
  }, [drawPreviewMask, editor, preview, showOriginalOnly])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current)
      }
      previewAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }
      const menu = menuRef.current
      const target = event.target
      if (menu && target instanceof Node && menu.contains(target)) {
        return
      }
      dismissContextMenu()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!contextMenu || !stageRef.current || !menuRef.current) {
      return
    }

    const stageRect = stageRef.current.getBoundingClientRect()
    const menuRect = menuRef.current.getBoundingClientRect()
    const gutter = 10
    const maxLeft = Math.max(gutter, stageRect.width - menuRect.width - gutter)
    const maxTop = Math.max(gutter, stageRect.height - menuRect.height - gutter)
    const nextLeft = Math.min(contextMenu.left, maxLeft)
    const nextTop = Math.min(contextMenu.top, maxTop)

    if (nextLeft !== contextMenu.left || nextTop !== contextMenu.top) {
      setContextMenu((current) =>
        current
          ? {
              ...current,
              left: nextLeft,
              top: nextTop,
            }
          : current,
      )
    }
  }, [contextMenu])

  const effectiveFormat =
    exportMode === 'transparent' && (exportFormat === 'jpg' || exportFormat === 'bmp')
      ? 'png'
      : exportFormat

  const currentImageIndex = useMemo(
    () => dataset?.images.findIndex((image) => image.id === imageId) ?? -1,
    [dataset, imageId],
  )

  const clearPreview = () => {
    previewAbortRef.current?.abort()
    lastQueuedPointRef.current = null
    setPreview(null)
  }

  const dismissContextMenu = () => {
    setContextMenu(null)
    lastQueuedPointRef.current = null
  }

  const queuePreview = (x: number, y: number) => {
    if (!editor || editor.processingState !== 'ready') {
      return
    }
    const lastQueuedPoint = lastQueuedPointRef.current
    if (lastQueuedPoint) {
      const dx = x - lastQueuedPoint.x
      const dy = y - lastQueuedPoint.y
      if (Math.hypot(dx, dy) < PREVIEW_MIN_DISTANCE) {
        return
      }
    }
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current)
    }
    hoverTimerRef.current = window.setTimeout(async () => {
      try {
        previewAbortRef.current?.abort()
        const requestId = `preview-${requestCounterRef.current + 1}`
        requestCounterRef.current += 1
        const controller = new AbortController()
        previewAbortRef.current = controller
        lastQueuedPointRef.current = { x, y }
        const response = await requestPreview(imageId, x, y, requestId, controller.signal)
        if (response.requestId !== requestId) {
          return
        }
        startTransition(() => {
          setPreview(response)
        })
      } catch (requestError) {
        if (requestError instanceof Error && requestError.name === 'AbortError') {
          return
        }
        setError(requestError instanceof Error ? requestError.message : 'Preview request failed.')
      }
    }, PREVIEW_DEBOUNCE_MS)
  }

  const updateViewport = () => {
    const image = imageRef.current
    if (!image) {
      return
    }
    setViewport({ width: image.clientWidth, height: image.clientHeight })
  }

  const relativePoint = (event: React.MouseEvent<HTMLDivElement>) => {
    const image = imageRef.current
    if (!image || !editor) {
      return null
    }
    const rect = image.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * editor.width
    const y = ((event.clientY - rect.top) / rect.height) * editor.height
    return {
      x: Math.max(0, Math.min(editor.width - 1, x)),
      y: Math.max(0, Math.min(editor.height - 1, y)),
    }
  }

  const onMaskAction = async (mode: 'mask' | 'unmask') => {
    if (!preview || !editor) {
      return
    }
    try {
      setIsWorking(true)
      const nextEditor = await commitPreview(imageId, mode, preview.previewId, preview.prompt)
      setEditor(nextEditor)
      setPreview(null)
      setContextMenu(null)
      setImageUrlToken((token) => token + 1)
      const nextDataset = await getDataset(datasetId)
      setDataset(nextDataset)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to commit the preview.')
    } finally {
      setIsWorking(false)
    }
  }

  const runEditorAction = async (action: 'undo' | 'redo' | 'restore') => {
    try {
      setIsWorking(true)
      const nextEditor =
        action === 'undo'
          ? await undoEdit(imageId)
          : action === 'redo'
            ? await redoEdit(imageId)
            : await restoreEdit(imageId)
      setEditor(nextEditor)
      setPreview(null)
      setContextMenu(null)
      setImageUrlToken((token) => token + 1)
      const nextDataset = await getDataset(datasetId)
      setDataset(nextDataset)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update the editor state.')
    } finally {
      setIsWorking(false)
    }
  }

  const onExportImage = async () => {
    if (!editor) {
      return
    }
    try {
      setIsWorking(true)
      await exportImage(
        editor.id,
        effectiveFormat,
        exportMode,
        editor.relativePath.replace(/\.[^.]+$/, `.${effectiveFormat}`),
      )
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to export the current image.')
    } finally {
      setIsWorking(false)
    }
  }

  if (!editor || !dataset) {
    return (
      <section className="page">
        <div className="panel">
          <h1>Editor loading</h1>
          <p>{error ?? 'Preparing canvas state…'}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="page editor-page">
      <aside className="sidebar panel">
        <div className="section-heading">
          <h2>Dataset browser</h2>
          <span>{dataset.images.length} images</span>
        </div>
        <div className="sidebar-links">
          <Link className="secondary-button" to={`/datasets/${dataset.id}`}>
            Back to dataset
          </Link>
          <a className="link-button" href={editor.historyUrl}>
            Download history JSON
          </a>
        </div>
        <ul className="image-nav-list">
          {dataset.images.map((image, index) => (
            <li key={image.id} className={image.id === editor.id ? 'active' : ''}>
              <Link to={`/datasets/${dataset.id}/images/${image.id}`}>
                <strong>{index + 1}. {image.relativePath}</strong>
                <span>{image.processingState}</span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

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
            <span className={`status-pill status-${editor.processingState}`}>
              {editor.processingState}
            </span>
            <span>Image {currentImageIndex + 1} of {dataset.images.length}</span>
          </div>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}

        <div className="toolbar-grid editor-toolbar">
          <button className="secondary-button" type="button" onClick={() => runEditorAction('undo')} disabled={!editor.canUndo || isWorking}>
            Undo
          </button>
          <button className="secondary-button" type="button" onClick={() => runEditorAction('redo')} disabled={!editor.canRedo || isWorking}>
            Redo
          </button>
          <button className="secondary-button" type="button" onClick={() => runEditorAction('restore')} disabled={isWorking}>
            Restore original
          </button>
          <button className="secondary-button" type="button" onClick={() => setShowCommittedMask((value) => !value)}>
            {showCommittedMask ? 'Hide mask' : 'Show mask'}
          </button>
          <button className="secondary-button" type="button" onClick={() => setShowOriginalOnly((value) => !value)}>
            {showOriginalOnly ? 'Show overlays' : 'View original'}
          </button>
          <label>
            Mode
            <select value={exportMode} onChange={(event) => setExportMode(event.target.value as ExportMode)}>
              {exportModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label>
            Format
            <select value={effectiveFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
              {exportFormats.map((format) => (
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
          <button className="primary-button" type="button" onClick={onExportImage} disabled={isWorking}>
            {isWorking ? 'Working…' : 'Export image'}
          </button>
        </div>

        {editor.processingState !== 'ready' ? (
          <div className="panel">
            <h2>Image not prepared yet</h2>
            <p>
              Queue this dataset from the dataset page first. Interactive previewing stays locked
              until the sequential preparation step has finished.
            </p>
          </div>
        ) : (
          <div className="editor-stage-shell panel">
            <div
              ref={stageRef}
              className="editor-stage"
              style={{ width: viewport.width || undefined }}
              onMouseMove={(event) => {
                const point = relativePoint(event)
                if (!point) {
                  return
                }
                if (contextMenu) {
                  return
                }
                queuePreview(point.x, point.y)
              }}
              onMouseLeave={() => {
                if (!contextMenu) {
                  clearPreview()
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                const point = relativePoint(event)
                if (!point || !preview) {
                  return
                }
                const stageRect = event.currentTarget.getBoundingClientRect()
                const cursorOffset = 8
                setContextMenu({
                  left: event.clientX - stageRect.left + cursorOffset,
                  top: event.clientY - stageRect.top + cursorOffset,
                  x: point.x,
                  y: point.y,
                })
              }}
            >
              <img
                key={`${editor.originalUrl}-${imageUrlToken}`}
                ref={imageRef}
                className="editor-image"
                src={`${editor.originalUrl}?v=${imageUrlToken}`}
                alt={editor.relativePath}
                onLoad={updateViewport}
              />
              <canvas ref={committedMaskRef} className="editor-canvas" />
              <canvas ref={previewMaskRef} className="editor-canvas" />
              {contextMenu ? (
                <div
                  ref={menuRef}
                  className="context-menu"
                  style={{ left: contextMenu.left, top: contextMenu.top }}
                >
                  <button type="button" onClick={() => void onMaskAction('mask')}>
                    Mask
                  </button>
                  <button type="button" onClick={() => void onMaskAction('unmask')}>
                    Unmask
                  </button>
                  <button type="button" onClick={dismissContextMenu}>
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
            <div className="helper-bar">
              <span>Hover to request a debounced SAM3 preview.</span>
              <span>Right-click a live preview to commit Mask or Unmask.</span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
