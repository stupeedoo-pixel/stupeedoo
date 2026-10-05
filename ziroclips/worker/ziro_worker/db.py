"""Postgres access for the worker (schema owned by Prisma in web/prisma/schema.prisma).

The job queue is a plain table claimed with `FOR UPDATE SKIP LOCKED`, so any
number of worker processes/machines can pull from it safely.
"""
from __future__ import annotations

import logging
import secrets
import time
from contextlib import contextmanager
from typing import Any, Iterator

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .config import settings

log = logging.getLogger(__name__)
_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        url = settings().database_url.split("?schema=")[0]  # Prisma-specific query param
        _pool = ConnectionPool(url, min_size=1, max_size=max(4, settings().worker_concurrency * 3), kwargs={"row_factory": dict_row}, open=True)
    return _pool


@contextmanager
def cursor() -> Iterator[Any]:
    with pool().connection() as conn:
        with conn.cursor() as cur:
            yield cur


def q(sql: str, params: tuple | dict = ()) -> list[dict]:
    with cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else []


def q1(sql: str, params: tuple | dict = ()) -> dict | None:
    rows = q(sql, params)
    return rows[0] if rows else None


def new_id() -> str:
    """Collision-resistant id compatible with Prisma's String @id (cuid-like)."""
    return "c" + format(int(time.time() * 1000), "x") + secrets.token_hex(8)


def J(v: Any) -> Jsonb:
    return Jsonb(v)


class JobCancelled(Exception):
    """Raised when a job's row disappeared or was cancelled (e.g. project deleted)."""


# ----------------------------------------------------------------- jobs

def claim_job(worker_id: str) -> dict | None:
    return q1(
        """
        UPDATE jobs SET status = 'RUNNING', locked_by = %s, attempts = attempts + 1,
               started_at = now(), heartbeat_at = now(), updated_at = now(), error = NULL
        WHERE id = (
            SELECT id FROM jobs
            WHERE status = 'QUEUED' AND run_after <= now()
            ORDER BY priority DESC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING *
        """,
        (worker_id,),
    )


def heartbeat(job_id: str, progress: int | None = None, stage: str | None = None) -> None:
    row = q1(
        """
        UPDATE jobs SET heartbeat_at = now(), updated_at = now(),
               progress = COALESCE(%s, progress), stage = COALESCE(%s, stage)
        WHERE id = %s AND status = 'RUNNING'
        RETURNING id
        """,
        (progress, stage, job_id),
    )
    if row is None:
        raise JobCancelled(job_id)


def finish_job(job_id: str, result: dict | None = None) -> None:
    q("UPDATE jobs SET status='SUCCEEDED', progress=100, result=%s, finished_at=now(), updated_at=now() WHERE id=%s",
      (J(result or {}), job_id))


def fail_job(job: dict, error: str, retryable: bool) -> bool:
    """Mark failed or schedule a retry with backoff. Returns True if it will retry."""
    will_retry = retryable and job["attempts"] < job["max_attempts"]
    if will_retry:
        backoff = 30 * (2 ** (job["attempts"] - 1))
        q("""UPDATE jobs SET status='QUEUED', error=%s, locked_by=NULL, updated_at=now(),
                    run_after = now() + make_interval(secs => %s) WHERE id=%s""",
          (error[:2000], backoff, job["id"]))
    else:
        q("UPDATE jobs SET status='FAILED', error=%s, finished_at=now(), updated_at=now() WHERE id=%s",
          (error[:2000], job["id"]))
    return will_retry


def requeue_stale(stale_sec: int) -> int:
    """Recover jobs whose worker died (no heartbeat). Over-attempted ones fail."""
    rows = q(
        """
        UPDATE jobs SET
            status = (CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'QUEUED' END)::"JobStatus",
            error = 'Worker stopped responding', locked_by = NULL, updated_at = now()
        WHERE status = 'RUNNING' AND heartbeat_at < now() - make_interval(secs => %s)
        RETURNING id, status, type, project_id
        """,
        (stale_sec,),
    )
    for r in rows:
        if r["status"] == "FAILED" and r["type"] == "PROCESS_PROJECT" and r["project_id"]:
            update_project(r["project_id"], status="FAILED", error="Processing was interrupted. Please retry.", stage="Failed")
    return len(rows)


# ----------------------------------------------------------------- domain helpers

_PROJECT_COLS = {"status", "progress", "stage", "error", "duration_sec", "width", "height", "fps", "language",
                 "source_key", "proxy_key", "title"}


def update_project(project_id: str, **fields: Any) -> None:
    bad = set(fields) - _PROJECT_COLS
    if bad:
        raise ValueError(f"unknown project fields {bad}")
    sets = ", ".join(f"{k} = %s" + ('::"ProjectStatus"' if k == "status" else "") for k in fields)
    q(f"UPDATE projects SET {sets}, updated_at = now() WHERE id = %s", (*fields.values(), project_id))


def get_project(project_id: str) -> dict | None:
    return q1("SELECT * FROM projects WHERE id = %s", (project_id,))


def get_user(user_id: str) -> dict | None:
    return q1("SELECT id, plan, role FROM users WHERE id = %s", (user_id,))


def record_usage(user_id: str, kind: str, amount: float, project_id: str | None) -> None:
    q("""INSERT INTO usage_events (id, user_id, kind, amount, project_id) VALUES (%s, %s, %s::"UsageKind", %s, %s)""",
      (new_id(), user_id, kind, amount, project_id))


def minutes_used_this_month(user_id: str, exclude_project: str | None = None) -> float:
    row = q1(
        """SELECT COALESCE(SUM(amount), 0) AS total FROM usage_events
           WHERE user_id = %s AND kind = 'MINUTES_PROCESSED'
             AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
             AND (project_id IS DISTINCT FROM %s)""",
        (user_id, exclude_project),
    )
    return float(row["total"]) if row else 0.0
