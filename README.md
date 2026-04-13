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

Frontend dependencies are already installed under `frontend/node_modules`, and backend dependencies are installed in `backend/.venv`.

Start the backend:

```bash
uv run --project backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173`.

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

You can verify the active runtime at `GET /api/health`, which now reports both `backend` and `device`.

## Verification

Backend tests:

```bash
cd /home/elek/automask
uv run --project backend python -m pytest
```

Frontend checks:

```bash
cd /home/elek/automask/frontend
npm run lint
npm run build
```
