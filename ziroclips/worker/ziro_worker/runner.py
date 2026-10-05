"""Job loop + janitor. Runs inside the FastAPI process (see api.py) or standalone."""
from __future__ import annotations

import logging
import tempfile
import threading
import time
import traceback
from pathlib import Path

from . import db, storage
from .config import settings
from .errors import UserFacingError
from .jobs import export_clip, find_more, process_project, regenerate_captions
from .jobs.common import Reporter

log = logging.getLogger("ziro.worker")

HANDLERS = {
    "PROCESS_PROJECT": process_project.run,
    "FIND_MORE_CLIPS": find_more.run,
    "REGENERATE_CAPTIONS": regenerate_captions.run,
    "EXPORT_CLIP": export_clip.run,
}

GENERIC_ERROR = "Something went wrong while processing. We'll retry automatically; if it keeps failing, try re-uploading."


class Worker:
    def __init__(self) -> None:
        self.stop = threading.Event()
        self.current: dict[str, dict] = {}  # thread name -> job summary (for /health)
        self.threads: list[threading.Thread] = []
        self.processed = 0
        self.failed = 0

    # ---------------------------------------------------------------- lifecycle
    def start(self) -> None:
        n = settings().worker_concurrency
        for i in range(n):
            t = threading.Thread(target=self._loop, name=f"job-{i}", daemon=True)
            t.start()
            self.threads.append(t)
        j = threading.Thread(target=self._janitor, name="janitor", daemon=True)
        j.start()
        self.threads.append(j)
        log.info("worker %s started with %d job thread(s)", settings().worker_id, n)

    def shutdown(self, timeout: float = 30) -> None:
        self.stop.set()
        for t in self.threads:
            t.join(timeout=timeout / max(1, len(self.threads)))

    # ---------------------------------------------------------------- loop
    def _loop(self) -> None:
        name = threading.current_thread().name
        while not self.stop.is_set():
            try:
                job = db.claim_job(f"{settings().worker_id}/{name}")
            except Exception as e:
                log.error("claim failed: %s", e)
                self.stop.wait(5)
                continue
            if not job:
                self.stop.wait(settings().poll_interval_sec)
                continue
            self.current[name] = {"id": job["id"], "type": job["type"], "since": time.time()}
            try:
                self._run(job)
            finally:
                self.current.pop(name, None)

    def _run(self, job: dict) -> None:
        jid, jtype = job["id"], job["type"]
        extra = {"job_id": jid, "project_id": job.get("project_id"), "clip_id": job.get("clip_id")}
        log.info("start %s %s (attempt %d/%d)", jtype, jid, job["attempts"], job["max_attempts"], extra=extra)
        started = time.monotonic()
        rep = Reporter(jid, job.get("project_id"))

        # Background heartbeat so long FFmpeg steps never look "stale".
        hb_stop = threading.Event()

        def beat() -> None:
            while not hb_stop.wait(30):
                try:
                    db.heartbeat(jid)
                except db.JobCancelled:
                    return
                except Exception as e:  # transient DB hiccup
                    log.warning("heartbeat failed: %s", e)

        threading.Thread(target=beat, daemon=True).start()
        tmp_root = settings().tmp_dir or None
        try:
            with tempfile.TemporaryDirectory(prefix=f"ziro-{jid}-", dir=tmp_root) as tmp:  # always cleaned up
                result = HANDLERS[jtype](job, rep, Path(tmp))
            db.finish_job(jid, result)
            self.processed += 1
            log.info("done %s %s in %.1fs: %s", jtype, jid, time.monotonic() - started, result, extra=extra)
        except db.JobCancelled:
            log.info("job %s cancelled (deleted)", jid, extra=extra)
        except Exception as e:
            self.failed += 1
            user_msg = str(e) if isinstance(e, UserFacingError) else GENERIC_ERROR
            retryable = e.retryable if isinstance(e, UserFacingError) else True
            log.error("failed %s %s: %s\n%s", jtype, jid, e, traceback.format_exc(), extra=extra)
            try:
                will_retry = db.fail_job(job, f"{type(e).__name__}: {e}", retryable)
                self._on_failure(job, user_msg, will_retry)
            except Exception as e2:
                log.error("failed to record failure: %s", e2)
        finally:
            hb_stop.set()

    @staticmethod
    def _on_failure(job: dict, msg: str, will_retry: bool) -> None:
        if job["type"] == "PROCESS_PROJECT" and job.get("project_id"):
            if will_retry:
                db.update_project(job["project_id"], status="QUEUED", stage="Hit a snag — retrying shortly…")
            else:
                db.update_project(job["project_id"], status="FAILED", stage="Failed", error=msg)
        elif job["type"] == "EXPORT_CLIP" and not will_retry:
            eid = (job.get("payload") or {}).get("exportId")
            if eid:
                db.q("""UPDATE exports SET status='FAILED'::"ExportStatus", error=%s, updated_at=now() WHERE id=%s""", (msg, eid))

    # ---------------------------------------------------------------- janitor
    def _janitor(self) -> None:
        """Every few minutes: recover stale jobs, enforce retention, drop abandoned uploads."""
        while not self.stop.wait(120):
            try:
                n = db.requeue_stale(settings().heartbeat_stale_sec)
                if n:
                    log.warning("requeued %d stale job(s)", n)
                self._retention()
            except Exception as e:
                log.error("janitor error: %s", e)

    @staticmethod
    def _retention() -> None:
        s = settings()
        # Rendered exports are cheap to regenerate; expire them to save storage.
        for row in db.q(
            """SELECT id, output_key FROM exports WHERE status='DONE' AND output_key IS NOT NULL
               AND updated_at < now() - make_interval(days => %s) LIMIT 200""", (s.export_ttl_days,)):
            storage.delete(row["output_key"])
            db.q("UPDATE exports SET output_key=NULL, updated_at=now() WHERE id=%s", (row["id"],))
        # Optionally purge large originals (the proxy stays; exports fall back to it).
        if s.source_ttl_days > 0:
            for row in db.q(
                """SELECT id, source_key FROM projects WHERE status='READY' AND source_key IS NOT NULL
                   AND created_at < now() - make_interval(days => %s) LIMIT 100""", (s.source_ttl_days,)):
                storage.delete(row["source_key"])
                db.update_project(row["id"], source_key=None)
        # Uploads abandoned for >24h.
        for row in db.q("SELECT id, user_id FROM projects WHERE status='UPLOADING' AND created_at < now() - interval '24 hours' LIMIT 100"):
            prefix = storage.project_prefix(row["user_id"], row["id"])
            for key in (f"{prefix}/source.mp4", f"{prefix}/source.mov", f"{prefix}/source.webm", f"{prefix}/source.mkv", f"{prefix}/source.m4v"):
                storage.delete(key)
            db.q("DELETE FROM projects WHERE id=%s", (row["id"],))
