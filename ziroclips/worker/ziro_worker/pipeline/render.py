"""Final export renderer: trim + reframe + captions + overlays + logo + loudness.

One FFmpeg pass per clip:
  input seek (-ss) -> crop (time-varying x/y from the face track) -> scale ->
  ASS captions/text/B-roll -> emoji PNG overlays -> logo -> yuv420p H.264
  audio: EBU R128 loudness normalised to -14 LUFS (TikTok/YouTube/IG target)
"""
from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..config import settings
from .captions import EmojiEvent, build_ass
from .media import ffmpeg_base, run

log = logging.getLogger(__name__)

OUTPUT_SIZES = {
    "1080p": {"9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350), "16:9": (1920, 1080)},
    "4k": {"9:16": (2160, 3840), "1:1": (2160, 2160), "4:5": (2160, 2700), "16:9": (3840, 2160)},
}


def aspect_value(ar: str) -> float:
    w, _, h = ar.partition(":")
    try:
        return float(w) / float(h)
    except (ValueError, ZeroDivisionError):
        return 9 / 16


def _piecewise(track: list[dict], key: str, t0: float, dur: float) -> str:
    """FFmpeg expression of a piecewise-linear function of t (clip-relative)."""
    pts = [(round(k["t"] - t0, 3), float(k[key])) for k in track]
    pts = [p for p in pts if -5 <= p[0] <= dur + 5] or [(0.0, float(track[0][key]) if track else 0.5)]
    if len(pts) == 1:
        return f"{pts[0][1]:.4f}"
    expr = f"{pts[-1][1]:.4f}"
    for (ta, va), (tb, vb) in reversed(list(zip(pts, pts[1:]))):
        span = max(tb - ta, 1e-3)
        seg = f"({va:.4f}+({vb - va:.4f})*(t-({ta:.3f}))/{span:.3f})"
        expr = f"if(lt(t,{tb:.3f}),{seg},{expr})"
    return f"if(lt(t,{pts[0][0]:.3f}),{pts[0][1]:.4f},{expr})"


def crop_filter(track: list[dict], t0: float, dur: float, src_w: int, src_h: int, aspect: float) -> str:
    src_aspect = src_w / src_h
    if aspect <= src_aspect:
        cw = int(round(src_h * aspect)) // 2 * 2
        cx = _piecewise(track, "x", t0, dur)
        return f"crop={cw}:{src_h}:'max(0,min(iw-{cw},({cx})*iw-{cw}/2))':0"
    ch = int(round(src_w / aspect)) // 2 * 2
    cy = _piecewise(track, "y", t0, dur)
    return f"crop={src_w}:{ch}:0:'max(0,min(ih-{ch},({cy})*ih-{ch}/2))'"


_EMOJI_FONTS = [
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
    "/usr/share/fonts/noto/NotoColorEmoji.ttf",
    "/System/Library/Fonts/Apple Color Emoji.ttc",
]


def emoji_png(emoji: str, size: int, out: Path) -> Path | None:
    """Render a colour emoji to PNG (libass can't draw colour glyphs)."""
    font_path = next((p for p in _EMOJI_FONTS if Path(p).exists()), None)
    if not font_path:
        log.warning("No colour emoji font found; skipping emoji overlays (install fonts-noto-color-emoji)")
        return None
    try:
        font = ImageFont.truetype(font_path, 109)  # CBDT bitmap font only renders at 109px
        img = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
        ImageDraw.Draw(img).text((80, 80), emoji, font=font, embedded_color=True, anchor="mm")
        bbox = img.getbbox()
        if not bbox:
            return None
        img = img.crop(bbox)
        img.thumbnail((size, size), Image.LANCZOS)
        img.save(out)
        return out
    except Exception as e:  # pragma: no cover - font quirks
        log.warning("emoji render failed for %r: %s", emoji, e)
        return None


def render_clip(src: str, out: Path, work: Path, snapshot: dict, resolution: str, src_w: int, src_h: int, logo: Path | None = None) -> Path:
    s = settings()
    start, end = float(snapshot["startSec"]), float(snapshot["endSec"])
    dur = end - start
    ar = snapshot.get("aspectRatio") or "9:16"
    W, H = OUTPUT_SIZES.get(resolution, OUTPUT_SIZES["1080p"]).get(ar, (1080, 1920))
    track = snapshot.get("cropTrack") or []

    ass_doc, emoji_events = build_ass(snapshot.get("words") or [], start, end, snapshot.get("captionStyle") or {}, snapshot.get("overlays") or [], W, H)
    ass_path = work / "captions.ass"
    ass_path.write_text(ass_doc, encoding="utf-8")

    inputs: list[str] = ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", src]
    fonts_dir = Path(s.fonts_dir)
    ass_opt = f"ass={ass_path.name}" + (f":fontsdir={fonts_dir}" if fonts_dir.is_dir() else "")
    chain = [
        f"[0:v]{crop_filter(track, start, dur, src_w, src_h, aspect_value(ar))}",
        f"scale={W}:{H}:flags=lanczos",
        "setsar=1",
        ass_opt,
    ]
    graph = [",".join(chain) + "[v0]"]
    last = "v0"
    idx = 1

    for i, ev in enumerate(emoji_events):
        png = emoji_png(ev.emoji, ev.size, work / f"emoji_{i}.png")
        if not png:
            continue
        inputs += ["-i", str(png)]
        graph.append(f"[{last}][{idx}:v]overlay=x={ev.x:.0f}-w/2:y={ev.y:.0f}-h/2:enable='between(t,{ev.start:.3f},{ev.end:.3f})'[v{idx}]")
        last, idx = f"v{idx}", idx + 1

    brand = snapshot.get("brand") or {}
    if logo is not None:
        lw = int(W * float(brand.get("logoScalePct") or 0.14))
        m = int(min(W, H) * 0.04)
        pos = brand.get("logoPosition") or "top-right"
        x = f"{m}" if "left" in pos else f"W-w-{m}"
        y = f"{m}" if "top" in pos else f"H-h-{m}"
        inputs += ["-i", str(logo)]
        graph.append(f"[{idx}:v]scale={lw}:-1[logo];[{last}][logo]overlay=x={x}:y={y}[v{idx}]")
        last, idx = f"v{idx}", idx + 1

    graph.append(f"[{last}]format=yuv420p[vout]")
    graph.append("[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]")

    cmd = ffmpeg_base() + inputs + [
        "-filter_complex", ";".join(graph),
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", s.export_preset, "-crf", str(s.export_crf), "-profile:v", "high",
        "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        "-t", f"{dur:.3f}", str(out),
    ]
    # ass filter resolves its filename relative to cwd; run inside the work dir.
    import subprocess

    log.debug("render cmd: %s", " ".join(cmd)[:2000])
    proc = subprocess.run(cmd, cwd=work, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg render failed: {proc.stderr.decode(errors='replace')[-1500:]}")
    return out


__all__ = ["render_clip", "crop_filter", "emoji_png", "OUTPUT_SIZES", "EmojiEvent", "run"]
