import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  commitPreview: vi.fn(),
  exportImage: vi.fn(),
  getDataset: vi.fn(),
  getEditorState: vi.fn(),
  redoEdit: vi.fn(),
  restoreEdit: vi.fn(),
  undoEdit: vi.fn(),
}))

import { getDataset, getEditorState } from '../api'
import { EditorPage } from '../pages/EditorPage'

describe('EditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading panel while editor data is still resolving', () => {
    vi.mocked(getDataset).mockReturnValue(new Promise(() => undefined))
    vi.mocked(getEditorState).mockReturnValue(new Promise(() => undefined))

    render(
      <MemoryRouter initialEntries={['/datasets/dataset-1/images/image-1']}>
        <Routes>
          <Route path="/datasets/:datasetId/images/:imageId" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText(/Editor loading/i)).toBeInTheDocument()
    expect(screen.getByText(/Preparing dataset context and editor state/i)).toBeInTheDocument()
  })

  it('renders grouped controls and interaction help for a ready image', async () => {
    vi.mocked(getDataset).mockResolvedValue({
      id: 'dataset-1',
      name: 'Research Set',
      sourceType: 'upload',
      rootPath: '/tmp/research-set',
      itemCount: 1,
      createdAt: '2026-04-13T00:00:00Z',
      summary: {
        processingCounts: { pending: 0, queued: 0, preparing: 0, ready: 1, failed: 0 },
        labelCounts: { todo: 1, in_progress: 0, completed: 0 },
        hasInFlightWork: false,
      },
      actions: {
        canStartProcessing: false,
        canExportDataset: true,
        recommendedPrimaryAction: 'review_ready',
      },
      images: [
        {
          id: 'image-1',
          datasetId: 'dataset-1',
          relativePath: 'alpha.png',
          width: 48,
          height: 48,
          workflowLabel: 'todo',
          processingState: 'ready',
          hasSavedMask: false,
          historyDepth: 0,
          lastError: null,
          originalUrl: '/api/images/image-1/original',
          historyUrl: '/api/images/image-1/history',
          actions: { canOpenEditor: true, canRemove: true },
        },
      ],
    })
    vi.mocked(getEditorState).mockResolvedValue({
      id: 'image-1',
      datasetId: 'dataset-1',
      relativePath: 'alpha.png',
      width: 48,
      height: 48,
      workflowLabel: 'todo',
      processingState: 'ready',
      hasSavedMask: false,
      historyDepth: 0,
      canUndo: false,
      canRedo: false,
      originalUrl: '/api/images/image-1/original',
      historyUrl: '/api/images/image-1/history',
      committedMaskPngBase64: null,
    })

    render(
      <MemoryRouter initialEntries={['/datasets/dataset-1/images/image-1']}>
        <Routes>
          <Route path="/datasets/:datasetId/images/:imageId" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('alpha.png')).toBeInTheDocument()
    expect(screen.getByText(/^Edit$/i)).toBeInTheDocument()
    expect(screen.getByText(/^View$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Export$/i)).toBeInTheDocument()
    expect(screen.getByText(/Hover to request a preview/i)).toBeInTheDocument()
    expect(screen.getByText(/Right-click to lock the prompt and choose the edit action/i)).toBeInTheDocument()
  })
})
