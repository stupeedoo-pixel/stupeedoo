from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .. import db, storage
from ..config import settings
from ..pipeline import media, reframe

log = logging.getLogger(__name__)


@dataclass
class Reporter:
    """Throttled progress reporting to the job row (and optionally the project)."""
    job_id: str
    project_id: str | None = None
    mirror_project: bool = False
    _last: float = field(default=0.0, repr=False)
    _stage: str | None = field(default=None, repr=False)

    def __call__(self, progress: float, stage: str | None = None, force: bool = False) -> None:
        now = time.monotonic()
        stage_changed = stage is not None and stage != self._stage
        if not (force or stage_changed or now - self._last > 1.5):
            return
        self._last = now
        self._stage = stage or self._stage
        pct = int(max(0, min(100, progress)))
        db.heartbeat(self.job_id, pct, self._stage)  # raises JobCancelled if the job vanished
        if self.mirror_project and self.project_id:
            db.update_project(self.project_id, progress=pct, stage=self._stage)

    def span(self, lo: float, hi: float, stage: str):
        """Sub-reporter mapping 0..1 onto [lo, hi]%."""
        self(lo, stage, force=True)
        return lambda f: self(lo + (hi - lo) * max(0.0, min(1.0, f)), stage)


def default_caption_style(user_id: str, project_settings: dict) -> dict:
    kit = db.q1("SELECT caption_style FROM brand_kits WHERE user_id = %s", (user_id,))
    if project_settings.get("captionTemplate"):
        return {"template": project_settings["captionTemplate"]}
    if kit and kit.get("caption_style"):
        return kit["caption_style"]
    return {"template": "bold-modern"}


def analyze_clips(src_path: str, cands, project: dict, prefix: str, tmp: Path, progress) -> list[dict]:
    """Face-track + thumbnail each candidate in parallel. Returns per-clip media data."""
    w, h = project["width"], project["height"]
    done = 0

    def one(i_c):
        nonlocal done
        i, c = i_c
        try:
            track = reframe.track(src_path, c.start, c.end, w, h)
        except Exception as e:  # reframing must never sink the whole job
            log.warning("face tracking failed for clip %d: %s", i, e)
            track = [{"t": round(c.start, 3), "x": 0.5, "y": 0.45}]
        thumb_t = min(c.end, c.start + 1.0)
        cx, _ = reframe.center_at(track, thumb_t)
        thumb_key = f"{prefix}/thumbs/{db.new_id()}.jpg"
        try:
            jpg = media.thumbnail(src_path, thumb_t, tmp / f"thumb_{i}.jpg", w, h, cx)
            storage.put(jpg, thumb_key, "image/jpeg")
        except Exception as e:
            log.warning("thumbnail failed for clip %d: %s", i, e)
            thumb_key = None
        done += 1
        progress(done / max(1, len(cands)))
        return {"track": track, "thumb_key": thumb_key}

    with ThreadPoolExecutor(max_workers=settings().reframe_parallelism) as ex:
        return list(ex.map(one, enumerate(cands)))


def insert_clips(project_id: str, cands, media_data: list[dict], words: list[dict], energy, caption_style: dict, start_position: int) -> int:
    from ..pipeline.scoring import score
    from ..pipeline.transcribe import words_in

    rows = []
    for c, m in zip(cands, media_data):
        total, breakdown = score(c, words, energy)
        rows.append((c, m, total, breakdown))
    # Highest score first within this batch.
    rows.sort(key=lambda r: -r[2])
    with db.cursor() as cur:
        for i, (c, m, total, breakdown) in enumerate(rows):
            cur.execute(
                """INSERT INTO clips (id, project_id, position, title, hook, reasoning, hashtags, start_sec, end_sec,
                       virality_score, score_breakdown, words, crop_track, caption_style, overlays, aspect_ratio, thumbnail_key, updated_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'[]'::jsonb,'9:16',%s,now())""",
                (db.new_id(), project_id, start_position + i, c.title or "Untitled clip", c.hook or None, c.reasoning or None,
                 c.hashtags, round(c.start, 3), round(c.end, 3), total, db.J(breakdown), db.J(words_in(words, c.start, c.end)),
                 db.J(m["track"]), db.J(caption_style), m["thumb_key"]),
            )
    return len(rows)
