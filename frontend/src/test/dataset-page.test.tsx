import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  deleteDatasetImage: vi.fn(),
  exportDataset: vi.fn(),
  exportImage: vi.fn(),
  getDataset: vi.fn(),
  getHealth: vi.fn(),
  startDataset: vi.fn(),
  updateWorkflowLabel: vi.fn(),
}))

import { getDataset, getHealth } from '../api'
import { DatasetPage } from '../pages/DatasetPage'

describe('DatasetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the server-driven primary action and filters the task list', async () => {
    vi.mocked(getHealth).mockResolvedValue({
      status: 'ok',
      backend: 'mock',
      device: 'cpu',
      ready: true,
      message: null,
    })
    vi.mocked(getDataset).mockResolvedValue({
      id: 'dataset-1',
      name: 'Research Set',
      sourceType: 'upload',
      rootPath: '/tmp/research-set',
      itemCount: 2,
      createdAt: '2026-04-13T00:00:00Z',
      summary: {
        processingCounts: { pending: 1, queued: 0, preparing: 0, ready: 1, failed: 0 },
        labelCounts: { todo: 1, in_progress: 1, completed: 0 },
        hasInFlightWork: false,
      },
      actions: {
        canStartProcessing: true,
        canExportDataset: true,
        recommendedPrimaryAction: 'review_ready',
      },
      images: [
        {
          id: 'image-a',
          datasetId: 'dataset-1',
          relativePath: 'alpha.png',
          width: 48,
          height: 48,
          workflowLabel: 'in_progress',
          processingState: 'ready',
          hasSavedMask: true,
          historyDepth: 2,
          lastError: null,
          originalUrl: '/api/images/image-a/original',
          historyUrl: '/api/images/image-a/history',
          actions: { canOpenEditor: true, canRemove: true },
        },
        {
          id: 'image-b',
          datasetId: 'dataset-1',
          relativePath: 'beta.png',
          width: null,
          height: null,
          workflowLabel: 'todo',
          processingState: 'pending',
          hasSavedMask: false,
          historyDepth: 0,
          lastError: null,
          originalUrl: '/api/images/image-b/original',
          historyUrl: '/api/images/image-b/history',
          actions: { canOpenEditor: false, canRemove: true },
        },
      ],
    })

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/datasets/dataset-1']}>
        <Routes>
          <Route path="/datasets/:datasetId" element={<DatasetPage />} />
          <Route path="/datasets/:datasetId/images/:imageId" element={<div>editor route</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Research Set')).toBeInTheDocument()
    expect(screen.getByText(/Review prepared images/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Review ready image/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add more data/i })).toHaveAttribute(
      'href',
      '/?datasetId=dataset-1',
    )
    expect(screen.getByText('alpha.png')).toBeInTheDocument()
    expect(screen.getByText('beta.png')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Search filenames/i), 'beta')

    await waitFor(() => {
      expect(screen.queryByText('alpha.png')).not.toBeInTheDocument()
    })
    expect(screen.getByText('beta.png')).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/Search filenames/i))
    await user.selectOptions(screen.getByLabelText(/Processing state/i), 'ready')

    await waitFor(() => {
      expect(screen.getByText('alpha.png')).toBeInTheDocument()
    })
    expect(screen.queryByText('beta.png')).not.toBeInTheDocument()
  })

  it('shows an empty-state message when the dataset has no images', async () => {
    vi.mocked(getHealth).mockResolvedValue({
      status: 'ok',
      backend: 'mock',
      device: 'cpu',
      ready: true,
      message: null,
    })
    vi.mocked(getDataset).mockResolvedValue({
      id: 'dataset-2',
      name: 'Cleared Set',
      sourceType: 'upload',
      rootPath: '/tmp/cleared-set',
      itemCount: 0,
      createdAt: '2026-04-13T00:00:00Z',
      summary: {
        processingCounts: { pending: 0, queued: 0, preparing: 0, ready: 0, failed: 0 },
        labelCounts: { todo: 0, in_progress: 0, completed: 0 },
        hasInFlightWork: false,
      },
      actions: {
        canStartProcessing: false,
        canExportDataset: false,
        recommendedPrimaryAction: 'upload_more',
      },
      images: [],
    })

    render(
      <MemoryRouter initialEntries={['/datasets/dataset-2']}>
        <Routes>
          <Route path="/datasets/:datasetId" element={<DatasetPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Cleared Set')).toBeInTheDocument()
    expect(screen.getByText(/This dataset is empty now/i)).toBeInTheDocument()
  })
})
