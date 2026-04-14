import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  getDataset: vi.fn(),
  getHealth: vi.fn(),
  uploadEntries: vi.fn(),
}))

import { getDataset, getHealth, uploadEntries } from '../api'
import { UploadPage } from '../pages/UploadPage'

function RouteStateProbe() {
  const location = useLocation()
  const flash = (location.state as { flash?: string } | null)?.flash
  return <div>{flash ?? 'no-flash'}</div>
}

describe('UploadPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows backend readiness guidance and selection review before upload', async () => {
    vi.mocked(getDataset).mockResolvedValue({
      id: 'dataset-unused',
      name: 'unused',
      sourceType: 'upload',
      rootPath: '/tmp/unused',
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
    vi.mocked(getHealth).mockResolvedValue({
      status: 'ok',
      backend: 'sam3',
      device: 'cuda',
      ready: false,
      message: 'Install a CUDA-enabled PyTorch build to enable SAM3.',
    })
    vi.mocked(uploadEntries).mockImplementation(async (entries, datasetName, onProgress) => {
      onProgress(entries.map((entry) => ({ relativePath: entry.relativePath, progress: 1 })))
      return {
        id: 'dataset-1',
        name: datasetName,
        sourceType: 'upload',
        rootPath: '/tmp/dataset-1',
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
            relativePath: 'sample.png',
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
      }
    })

    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/datasets/:datasetId/images/:imageId" element={<RouteStateProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Backend needs attention/i)).toBeInTheDocument()
    expect(screen.getByText(/Install a CUDA-enabled PyTorch build to enable SAM3\./i)).toBeInTheDocument()

    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    await user.upload(fileInput as HTMLInputElement, new File(['sample'], 'sample.png', { type: 'image/png' }))

    expect(await screen.findByText(/Selection review/i)).toBeInTheDocument()
    expect(screen.getByText(/1 staged item/i)).toBeInTheDocument()
    expect(screen.getByText(/Detected inputs/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Upload to AutoMask/i }))

    await waitFor(() => {
      expect(uploadEntries).toHaveBeenCalled()
    })
    expect(
      await screen.findByText(/The editor is open, so you can hover for previews/i),
    ).toBeInTheDocument()
  })

  it('appends uploads into an existing dataset when datasetId is present in the URL', async () => {
    vi.mocked(getHealth).mockResolvedValue({
      status: 'ok',
      backend: 'mock',
      device: 'cpu',
      ready: true,
      message: null,
    })
    vi.mocked(getDataset).mockResolvedValue({
      id: 'dataset-7',
      name: 'Existing Task List',
      sourceType: 'upload',
      rootPath: '/tmp/dataset-7',
      itemCount: 2,
      createdAt: '2026-04-13T00:00:00Z',
      summary: {
        processingCounts: { pending: 1, queued: 0, preparing: 0, ready: 1, failed: 0 },
        labelCounts: { todo: 2, in_progress: 0, completed: 0 },
        hasInFlightWork: false,
      },
      actions: {
        canStartProcessing: true,
        canExportDataset: true,
        recommendedPrimaryAction: 'start_processing',
      },
      images: [
        {
          id: 'image-old',
          datasetId: 'dataset-7',
          relativePath: 'old.png',
          width: 48,
          height: 48,
          workflowLabel: 'todo',
          processingState: 'ready',
          hasSavedMask: false,
          historyDepth: 0,
          lastError: null,
          originalUrl: '/api/images/image-old/original',
          historyUrl: '/api/images/image-old/history',
          actions: { canOpenEditor: true, canRemove: true },
        },
      ],
    })
    vi.mocked(uploadEntries).mockImplementation(async (_entries, datasetName, onProgress, options) => {
      onProgress([{ relativePath: 'new.png', progress: 1 }])
      expect(datasetName).toBe('Existing Task List')
      expect(options).toEqual({ datasetId: 'dataset-7' })
      return {
        id: 'dataset-7',
        name: datasetName,
        sourceType: 'upload',
        rootPath: '/tmp/dataset-7',
        itemCount: 3,
        createdAt: '2026-04-13T00:00:00Z',
        summary: {
          processingCounts: { pending: 1, queued: 0, preparing: 0, ready: 2, failed: 0 },
          labelCounts: { todo: 3, in_progress: 0, completed: 0 },
          hasInFlightWork: false,
        },
        actions: {
          canStartProcessing: true,
          canExportDataset: true,
          recommendedPrimaryAction: 'start_processing',
        },
        images: [
          {
            id: 'image-old',
            datasetId: 'dataset-7',
            relativePath: 'old.png',
            width: 48,
            height: 48,
            workflowLabel: 'todo',
            processingState: 'ready',
            hasSavedMask: false,
            historyDepth: 0,
            lastError: null,
            originalUrl: '/api/images/image-old/original',
            historyUrl: '/api/images/image-old/history',
            actions: { canOpenEditor: true, canRemove: true },
          },
          {
            id: 'image-new',
            datasetId: 'dataset-7',
            relativePath: 'new.png',
            width: 48,
            height: 48,
            workflowLabel: 'todo',
            processingState: 'ready',
            hasSavedMask: false,
            historyDepth: 0,
            lastError: null,
            originalUrl: '/api/images/image-new/original',
            historyUrl: '/api/images/image-new/history',
            actions: { canOpenEditor: true, canRemove: true },
          },
        ],
      }
    })

    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter initialEntries={['/?datasetId=dataset-7']}>
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/datasets/:datasetId" element={<RouteStateProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Add more files to the current task list/i)).toBeInTheDocument()
    expect(screen.getByText(/Adding data to Existing Task List/i)).toBeInTheDocument()

    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()
    await user.upload(fileInput as HTMLInputElement, new File(['sample'], 'new.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: /Add to task list/i }))

    await waitFor(() => {
      expect(uploadEntries).toHaveBeenCalled()
    })
    expect(await screen.findByText(/Added 1 item to Existing Task List/i)).toBeInTheDocument()
  })
})
