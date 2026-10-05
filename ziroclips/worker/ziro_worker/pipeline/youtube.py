"""YouTube import via yt-dlp.

Only public, non-live videos are accepted. Downloading YouTube content may
violate YouTube's Terms of Service unless you own the video or have permission;
the UI makes users confirm they have the rights. Disable with ENABLE_YOUTUBE=false.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from ..config import settings
from ..errors import UserFacingError

log = logging.getLogger(__name__)


def download(url: str, dest_dir: Path, max_minutes: float, progress: Callable[[float], None]) -> tuple[Path, dict]:
    import yt_dlp

    s = settings()
    if not s.enable_youtube:
        raise UserFacingError("YouTube import is disabled on this server.")
    base_opts: dict = {"quiet": True, "no_warnings": True, "noplaylist": True}
    if s.youtube_cookies_file:
        base_opts["cookiefile"] = s.youtube_cookies_file

    try:
        with yt_dlp.YoutubeDL(base_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise UserFacingError("We couldn't access that YouTube video. Is the URL correct and the video public?") from e

    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise UserFacingError("Live streams aren't supported — try again once the stream has ended.")
    if info.get("availability") not in (None, "public", "unlisted"):
        raise UserFacingError("Only public videos can be imported.")
    if info.get("age_limit", 0) >= 18:
        raise UserFacingError("Age-restricted videos can't be imported.")
    duration = float(info.get("duration") or 0)
    if duration > max_minutes * 60:
        raise UserFacingError(f"This video is {duration / 60:.0f} min; the limit is {max_minutes:.0f} min.")

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                progress(min(1.0, d.get("downloaded_bytes", 0) / total))

    h = s.youtube_max_height
    opts = {
        **base_opts,
        "format": f"bv*[height<={h}][ext=mp4]+ba[ext=m4a]/bv*[height<={h}]+ba/b[height<={h}]/b",
        "merge_output_format": "mp4",
        "outtmpl": str(dest_dir / "source.%(ext)s"),
        "progress_hooks": [hook],
        "retries": 5,
        "fragment_retries": 5,
        "concurrent_fragment_downloads": 4,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as e:
        raise UserFacingError("Downloading from YouTube failed. Please try again later.", retryable=True) from e

    files = sorted(dest_dir.glob("source.*"), key=lambda p: p.stat().st_size, reverse=True)
    if not files:
        raise UserFacingError("Download finished but no video file was produced.", retryable=True)
    return files[0], {"title": info.get("title"), "duration": duration, "uploader": info.get("uploader")}
