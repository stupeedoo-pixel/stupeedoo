"""EXPORT_CLIP: render the final MP4 from an immutable edit snapshot."""
from __future__ import annotations

import logging
from pathlib import Path

from .. import db, storage
from ..pipeline import media
from ..pipeline.render import render_clip
from .common import Reporter

log = logging.getLogger(__name__)


def run(job: dict, rep: Reporter, tmp: Path) -> dict:
    export_id = (job["payload"] or {}).get("exportId")
    exp = db.q1("SELECT * FROM exports WHERE id = %s", (export_id,))
    if not exp:
        return {"skipped": "export deleted"}
    project = db.get_project(job["project_id"])
    db.q("""UPDATE exports SET status='RENDERING'::"ExportStatus", error=NULL, updated_at=now() WHERE id=%s""", (export_id,))
    rep(5, "Preparing", force=True)

    # Prefer the original; fall back to the proxy if the source was purged by retention.
    if project["source_key"] and storage.exists(project["source_key"]):
        src, w, h = storage.ffmpeg_input(project["source_key"]), project["width"], project["height"]
    else:
        log.warning("source missing for project %s; rendering from proxy (lower quality)", project["id"])
        src = storage.ffmpeg_input(project["proxy_key"])
        info = media.probe(src)
        w, h = info.width, info.height

    snap = exp["snapshot"]
    logo = None
    brand = snap.get("brand") or {}
    if brand.get("logoKey"):
        try:
            logo = storage.fetch(brand["logoKey"], tmp)
        except FileNotFoundError:
            log.warning("logo %s missing; exporting without it", brand["logoKey"])

    rep(10, f"Rendering {exp['resolution']}", force=True)
    out = render_clip(src, tmp / "export.mp4", tmp, snap, exp["resolution"], w, h, logo)
    key = f"{storage.project_prefix(job['user_id'], project['id'])}/exports/{export_id}.mp4"
    rep(92, "Uploading", force=True)
    storage.put(out, key, "video/mp4")
    size = out.stat().st_size
    db.q("""UPDATE exports SET status='DONE'::"ExportStatus", output_key=%s, size_bytes=%s, updated_at=now() WHERE id=%s""", (key, size, export_id))
    db.record_usage(job["user_id"], "EXPORTS", 1, project["id"])
    return {"exportId": export_id, "bytes": size}
