"""FIND_MORE_CLIPS: run highlight detection again, excluding existing clip ranges."""
from __future__ import annotations

from pathlib import Path

from .. import db, storage
from ..errors import UserFacingError
from ..pipeline import highlights, media
from .common import Reporter, analyze_clips, default_caption_style, insert_clips


def run(job: dict, rep: Reporter, tmp: Path) -> dict:
    pid, uid = job["project_id"], job["user_id"]
    project = db.get_project(pid)
    tr = db.q1("SELECT words, segments FROM transcripts WHERE project_id = %s", (pid,))
    if not project or not tr:
        raise UserFacingError("This project has no transcript yet.")
    count = int((job["payload"] or {}).get("count") or 5)
    clips = db.q("SELECT start_sec, end_sec FROM clips WHERE project_id = %s", (pid,))
    opts_in = project["settings"] or {}

    rep(5, "Analyzing audio", force=True)
    src = storage.ffmpeg_input(project["source_key"])
    wav = media.extract_audio(src, tmp / "audio.wav")
    energy = media.audio_energy(wav)

    rep(25, "Looking for more moments", force=True)
    opts = highlights.Options(
        count=count,
        min_sec=float(opts_in.get("minSec") or 15),
        max_sec=float(opts_in.get("maxSec") or 90),
        exclude=[(c["start_sec"], c["end_sec"]) for c in clips],
    )
    cands = highlights.detect(tr["segments"], energy, project["duration_sec"], opts)
    if not cands:
        raise UserFacingError("No more strong moments found — you've got the best ones already!")

    local_src = str(storage.fetch(project["source_key"], tmp))
    media_data = analyze_clips(local_src, cands, project, storage.project_prefix(uid, pid), tmp, rep.span(50, 95, "Reframing new clips"))
    pos = db.q1("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM clips WHERE project_id = %s", (pid,))["p"]
    n = insert_clips(pid, cands, media_data, tr["words"], energy, default_caption_style(uid, opts_in), start_position=pos)
    db.record_usage(uid, "CLIPS_GENERATED", n, pid)
    return {"clips": n}
