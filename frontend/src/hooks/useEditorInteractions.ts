import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { requestPreview } from '../api'
import type { EditorState, PreviewResponse } from '../types'

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

function relativePoint(
  event: React.MouseEvent<HTMLDivElement>,
  image: HTMLImageElement | null,
  editor: EditorState | null,
) {
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

export function useEditorInteractions(
  editor: EditorState | null,
  imageId: string,
  onError: (message: string) => void,
) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [showCommittedMask, setShowCommittedMask] = useState(true)
  const [showOriginalOnly, setShowOriginalOnly] = useState(false)
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
    if (!editor) {
      return
    }

    void drawCommittedMask(
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

    void drawPreviewMask(
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
      setContextMenu(null)
      lastQueuedPointRef.current = null
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
        onError(requestError instanceof Error ? requestError.message : 'Preview request failed.')
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

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = relativePoint(event, imageRef.current, editor)
    if (!point || contextMenu) {
      return
    }
    queuePreview(point.x, point.y)
  }

  const handleMouseLeave = () => {
    if (!contextMenu) {
      clearPreview()
    }
  }

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const point = relativePoint(event, imageRef.current, editor)
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
  }

  const resetAfterMutation = () => {
    clearPreview()
    setContextMenu(null)
    setImageUrlToken((token) => token + 1)
  }

  return {
    preview,
    setPreview,
    contextMenu,
    showCommittedMask,
    setShowCommittedMask,
    showOriginalOnly,
    setShowOriginalOnly,
    imageUrlToken,
    viewport,
    stageRef,
    menuRef,
    imageRef,
    committedMaskRef,
    previewMaskRef,
    clearPreview,
    dismissContextMenu,
    updateViewport,
    handleMouseMove,
    handleMouseLeave,
    handleContextMenu,
    resetAfterMutation,
  }
}
