"""PROCESS_PROJECT: source -> transcript -> highlights -> reframe -> clips.

Progress budget (what the user sees in the UI):
   0-12  download (YouTube) / locate upload
  13-19  probe + audio extraction (proxy encode starts in parallel)
  20-55  transcription
  56-64  highlight detection
  65-90  face tracking + thumbnails (parallel)
  91-100 proxy upload + save clips
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .. import db, storage
from ..config import settings
from ..errors import UserFacingError
from ..pipeline import highlights, media, youtube
from ..pipeline.transcribe import ceil_minutes, segment, transcribe
from ..plans import PLAN_LIMITS
from .common import Reporter, analyze_clips, default_caption_style, insert_clips

log = logging.getLogger(__name__)


def run(job: dict, rep: Reporter, tmp: Path) -> dict:
    s = settings()
    pid, uid = job["project_id"], job["user_id"]
    project = db.get_project(pid)
    user = db.get_user(uid)
    if not project or not user:
        return {"skipped": "project deleted"}
    opts_in: dict = project["settings"] or {}
    rep.project_id, rep.mirror_project = pid, True
    db.update_project(pid, status="PROCESSING", stage="Starting", error=None, progress=1)

    limits = PLAN_LIMITS.get(user["plan"], PLAN_LIMITS["FREE"])
    max_minutes = min(limits["max_video_minutes"], s.max_video_minutes)
    prefix = storage.project_prefix(uid, pid)

    # ---- 1. source
    if project["source_type"] == "YOUTUBE":
        path, meta = youtube.download(project["source_url"], tmp, max_minutes, rep.span(1, 12, "Downloading from YouTube"))
        key = f"{prefix}/source{path.suffix}"
        storage.put(path, key, "video/mp4")
        fields = {"source_key": key}
        if meta.get("title") and project["title"] == "YouTube import":
            fields["title"] = meta["title"][:200]
        db.update_project(pid, **fields)
        src = str(path)
    else:
        rep(5, "Preparing upload", force=True)
        src = str(storage.fetch(project["source_key"], tmp))

    # ---- 2. probe + quota
    rep(13, "Analyzing video", force=True)
    info = media.probe(src)
    minutes = info.duration / 60
    if minutes > max_minutes:
        raise UserFacingError(f"This video is {minutes:.0f} minutes; your plan allows up to {max_minutes} minutes per video.")
    used = db.minutes_used_this_month(uid, exclude_project=pid)
    if used + minutes > limits["minutes_per_month"]:
        left = max(0, limits["minutes_per_month"] - used)
        raise UserFacingError(f"This video needs {minutes:.0f} min but you have {left:.0f} min left this month.")
    db.update_project(pid, duration_sec=info.duration, width=info.width, height=info.height, fps=info.fps)
    project.update(width=info.width, height=info.height, duration_sec=info.duration)

    with ThreadPoolExecutor(max_workers=1) as bg:
        proxy_future = bg.submit(media.make_proxy, src, tmp / "proxy.mp4")

        # ---- 3. audio + transcript
        wav = media.extract_audio(src, tmp / "audio.wav")
        energy = media.audio_energy(wav)
        rep(19, "Transcribing", force=True)
        tr = transcribe(wav, info.duration, energy, opts_in.get("language"), rep.span(20, 55, "Transcribing"))
        segs = segment(tr.words)
        text = " ".join(w["w"] for w in tr.words)
        with db.cursor() as cur:
            cur.execute("DELETE FROM transcripts WHERE project_id = %s", (pid,))
            cur.execute(
                "INSERT INTO transcripts (id, project_id, provider, language, words, segments, text) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (db.new_id(), pid, tr.provider, tr.language, db.J(tr.words), db.J(segs), text),
            )
        db.update_project(pid, language=tr.language)

        # ---- 4. highlights
        rep(56, "Finding the most engaging moments", force=True)
        opts = highlights.Options(
            count=int(opts_in.get("clipCount") or highlights.target_count(info.duration)),
            min_sec=float(opts_in.get("minSec") or 15),
            max_sec=float(opts_in.get("maxSec") or 90),
        )
        if opts.max_sec <= opts.min_sec:
            opts.max_sec = opts.min_sec + 15
        cands = highlights.detect(segs, energy, info.duration, opts)
        if not cands:
            raise UserFacingError("We couldn't find any strong standalone moments in this video. Try a shorter minimum clip length.")

        # ---- 5. reframe + thumbnails
        media_data = analyze_clips(src, cands, project, prefix, tmp, rep.span(65, 90, "Reframing clips around the speaker"))

        # ---- 6. proxy for the editor
        rep(91, "Preparing editor preview", force=True)
        proxy = proxy_future.result()
    proxy_key = f"{prefix}/proxy.mp4"
    storage.put(proxy, proxy_key, "video/mp4")

    # ---- 7. save clips (replace on re-run) + usage
    style = default_caption_style(uid, opts_in)
    db.q("DELETE FROM clips WHERE project_id = %s", (pid,))
    n = insert_clips(pid, cands, media_data, tr.words, energy, style, start_position=0)

    already_billed = db.q1("SELECT 1 AS x FROM usage_events WHERE project_id = %s AND kind = 'VIDEOS_PROCESSED'", (pid,))
    if not already_billed:
        db.record_usage(uid, "MINUTES_PROCESSED", ceil_minutes(info.duration), pid)
        db.record_usage(uid, "VIDEOS_PROCESSED", 1, pid)
        db.record_usage(uid, "CLIPS_GENERATED", n, pid)

    db.update_project(pid, status="READY", progress=100, stage="Ready", proxy_key=proxy_key, error=None)
    log.info("project %s ready: %d clips from %.1f min (%s)", pid, n, minutes, tr.provider)
    return {"clips": n, "minutes": round(minutes, 2), "transcriber": tr.provider, "method": cands[0].method}
