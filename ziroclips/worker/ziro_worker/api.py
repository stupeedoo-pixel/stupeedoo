"""FastAPI wrapper around the worker: health/metrics for your platform's checks.

Run:  uvicorn ziro_worker.api:app --host 0.0.0.0 --port 8000
The job threads start with the app and stop gracefully on shutdown.

ROADMAP: POST /jobs/{id}/cancel; Prometheus metrics; GPU worker pool routing
(e.g. send TRANSCRIBE work to Modal while CPU boxes do FFmpeg).
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from . import db
from .config import settings
from .logs import setup_logging
from .runner import Worker

worker = Worker()
STARTED = time.time()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    s = settings()
    setup_logging(s.log_level, s.log_json)
    worker.start()
    yield
    worker.shutdown()


app = FastAPI(title="ZiroClips worker", lifespan=lifespan)


@app.get("/health")
def health():
    try:
        db.q1("SELECT 1 AS ok")
        db_ok = True
    except Exception:
        db_ok = False
    alive = all(t.is_alive() for t in worker.threads)
    body = {
        "ok": db_ok and alive,
        "db": db_ok,
        "threads_alive": alive,
        "worker_id": settings().worker_id,
        "uptime_sec": int(time.time() - STARTED),
        "processed": worker.processed,
        "failed": worker.failed,
        "current": list(worker.current.values()),
        "config": {
            "transcribe": settings().transcribe_provider,
            "llm": settings().llm_provider if settings().anthropic_api_key or settings().llm_provider == "heuristic" else "heuristic (no key)",
            "storage": settings().storage_driver,
        },
    }
    return JSONResponse(body, status_code=200 if body["ok"] else 503)
