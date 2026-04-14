# AutoMask

Local-first interactive background removal workspace with a `React + Vite` frontend and a `FastAPI` backend.

## What is included

- Drag-and-drop upload for images, folders, `.zip`, and `.tar.gz`
- Dataset task view with manual `todo / in_progress / completed` labels
- Sequential backend preparation queue for GPU-safe inference
- Interactive editor with debounced hover previews, right-click `Mask / Unmask`, undo, redo, and restore
- Single-image and dataset export in `png / jpg / bmp / tiff`
- Persisted mask history JSON for reproducibility and session restore

## Project layout

- [frontend](./frontend): Vite/React client
- [backend](./backend): FastAPI service, SQLite metadata, storage, export, and inference queue
- [tech_requirement_sam3.md](./tech_requirement_sam3.md): original requirements document

## Run locally

1. Install frontend dependencies if needed:

```bash
cd frontend
npm install
```

2. Start the backend:

```bash
AUTOMASK_MODEL_BACKEND=sam3 AUTOMASK_MODEL_DEVICE=cuda uv run --project backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

3. Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

4. Open `http://127.0.0.1:5173`.

The upload screen now checks `GET /api/health` immediately and shows whether the backend is ready before you upload anything.

## First-run flow

- Upload page:
  - shows backend readiness, current backend/device, and setup guidance when SAM3 is not ready
  - lets you review the pending selection before upload with file count, size, detected input types, and progress
- Dataset page:
  - leads with workflow summary counts and a server-driven recommended next action
  - supports client-side filtering by filename, processing state, and workflow label
- Editor page:
  - groups controls into edit, view, and export sections
  - keeps hover preview and right-click mask/unmask flow, with persistent interaction help text

## SAM3 backend selection

The backend now defaults to `AUTOMASK_MODEL_BACKEND=sam3` with `AUTOMASK_MODEL_DEVICE=cuda`.
That means the normal app path is GPU-first: startup should use the real SAM3 backend on CUDA, and if CUDA or `sam3` is unavailable it should fail loudly instead of silently falling back to a CPU-style mock path.

Run with explicit CUDA-backed SAM3:

```bash
AUTOMASK_MODEL_BACKEND=sam3 AUTOMASK_MODEL_DEVICE=cuda uv run --project backend uvicorn app.main:app --reload
```

Optional environment variables:

- `AUTOMASK_MODEL_CHECKPOINT=/path/to/checkpoint.pt`
- `AUTOMASK_MODEL_DEVICE=cuda`
- `AUTOMASK_STORAGE_ROOT=/custom/storage/path`

The mock backend is still available, but only when you request it explicitly:

```bash
AUTOMASK_MODEL_BACKEND=mock uv run --project backend uvicorn app.main:app --reload
```

You can verify the active runtime at `GET /api/health`, which now reports:

- `backend`
- `device`
- `ready`
- `message`

If `ready` is `false`, the frontend upload screen will show that message directly.

## Troubleshooting

### Backend readiness says `ready: false`

- Open `http://127.0.0.1:8000/api/health` and read the `message` field.
- Restart the backend with the explicit SAM3 command:

```bash
AUTOMASK_MODEL_BACKEND=sam3 AUTOMASK_MODEL_DEVICE=cuda uv run --project backend uvicorn app.main:app --reload
```

- If CUDA-backed PyTorch is not available yet, use the mock backend temporarily:

```bash
AUTOMASK_MODEL_BACKEND=mock uv run --project backend uvicorn app.main:app --reload
```

### `npm run dev` says `vite: Permission denied`

This usually means your shell `PATH` in WSL includes an unreadable Windows `WindowsApps` entry, and `npm` hits that during command lookup. Remove that bad entry from `PATH`, then reinstall frontend dependencies if needed.

### Frontend starts but requests fail

- Confirm the backend is running on `http://127.0.0.1:8000`.
- Confirm the Vite dev server is running on `http://127.0.0.1:5173`.
- The default Vite proxy already forwards `/api/*` to the backend.

## Verification

Backend tests:

```bash
cd /home/elek/automask_sam3
uv run --project backend --extra dev python -m pytest backend/app/tests/test_api.py backend/app/tests/test_model_backend.py
```

Frontend checks:

```bash
cd /home/elek/automask_sam3/frontend
npm test
npm run build
```
