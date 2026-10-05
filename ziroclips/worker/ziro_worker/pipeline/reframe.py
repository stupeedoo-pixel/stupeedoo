"""AI Reframe: track the speaker's face so a 16:9 shot can be cropped to 9:16.

Pipeline per clip:
  1. ffmpeg decodes low-res grayscale frames at FACE_SAMPLE_FPS (fast; no seeking in Python)
  2. OpenCV face detection picks the subject (largest face, biased to continuity)
  3. gaps are filled, jitter is median-filtered
  4. a "virtual camera" with a dead-zone follows the subject smoothly, and
     hard-cuts when the subject jumps (shot change / different speaker)
  5. keyframes are simplified (RDP) — typically 1-20 points per clip

Output keyframes [{t, x, y}] (source seconds, normalized centre) drive both the
browser preview (CSS) and the export (FFmpeg crop expression).

Falls back to a centred crop when no face is found.
ROADMAP: active-speaker detection (lip motion / TalkNet) for multi-person shots;
MediaPipe/YuNet detector for profiles; split-screen layout for 2-person podcasts.
"""
from __future__ import annotations

import logging
import subprocess

import cv2
import numpy as np

from ..config import settings

log = logging.getLogger(__name__)
_SAMPLE_W = 320
_cascade = None


def _detector():
    global _cascade
    if _cascade is None:
        _cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    return _cascade


def _frames(src: str, start: float, dur: float, fps: float, w: int, h: int):
    sh = int(round(h * _SAMPLE_W / w / 2) * 2)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", src,
           "-vf", f"fps={fps},scale={_SAMPLE_W}:{sh}", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = _SAMPLE_W * sh
    i = 0
    try:
        while True:
            buf = proc.stdout.read(size)  # type: ignore[union-attr]
            if len(buf) < size:
                break
            yield start + i / fps, np.frombuffer(buf, dtype=np.uint8).reshape(sh, _SAMPLE_W), sh
            i += 1
    finally:
        proc.kill()
        proc.wait()


def track(src: str, start: float, end: float, src_w: int, src_h: int) -> list[dict]:
    fps = settings().face_sample_fps
    det = _detector()
    samples: list[tuple[float, float | None, float | None]] = []
    prev: tuple[float, float] | None = None
    for t, gray, sh in _frames(src, start, end - start, fps, src_w, src_h):
        faces = det.detectMultiScale(cv2.equalizeHist(gray), scaleFactor=1.15, minNeighbors=5, minSize=(max(18, sh // 14),) * 2)
        if len(faces) == 0:
            samples.append((t, None, None))
            continue

        def rank(f):
            x, y, fw, fh = f
            cx, cy = (x + fw / 2) / _SAMPLE_W, (y + fh / 2) / sh
            size = fw * fh / (_SAMPLE_W * sh)
            near = 0.0 if prev is None else abs(cx - prev[0])
            return size * 10 - near * 2  # big faces win; stay with the same subject when sizes are similar

        x, y, fw, fh = max(faces, key=rank)
        cx, cy = (x + fw / 2) / _SAMPLE_W, (y + fh * 0.45) / sh  # bias y slightly toward eyes
        prev = (cx, cy)
        samples.append((t, cx, cy))

    detected = [s for s in samples if s[1] is not None]
    if len(detected) < max(2, len(samples) * 0.15):
        return [{"t": round(start, 3), "x": 0.5, "y": 0.45}]  # no reliable subject: centre crop
    xs = _fill([s[1] for s in samples])
    ys = _fill([s[2] for s in samples])
    ts = [s[0] for s in samples]
    xs = _median(xs, 5)
    ys = _median(ys, 5)
    keys = _camera(ts, xs, ys, src_w, src_h)
    return keys


def _fill(v: list[float | None]) -> list[float]:
    out = list(v)
    last = next((x for x in out if x is not None), 0.5)
    for i, x in enumerate(out):
        if x is None:
            out[i] = last
        else:
            last = x
    return out  # type: ignore[return-value]


def _median(v: list[float], k: int) -> list[float]:
    a = np.array(v)
    pad = k // 2
    p = np.pad(a, pad, mode="edge")
    return [float(np.median(p[i : i + k])) for i in range(len(a))]


def _camera(ts: list[float], xs: list[float], ys: list[float], w: int, h: int) -> list[dict]:
    if max(xs) - min(xs) < 0.05:
        return [{"t": round(ts[0], 3), "x": round(float(np.median(xs)), 4), "y": round(float(np.median(ys)), 4)}]
    # Dead-zone is a fraction of the 9:16 crop width so small head movements don't move the camera.
    crop_frac = min(1.0, (h * 9 / 16) / w)
    dead = 0.18 * crop_frac
    cut_jump = 0.6 * crop_frac
    cam_x, cam_y = xs[0], ys[0]
    pts: list[tuple[float, float, float]] = [(ts[0], cam_x, cam_y)]
    pending_cut = 0
    for t, x, y in zip(ts[1:], xs[1:], ys[1:]):
        delta = x - cam_x
        if abs(delta) > cut_jump:
            pending_cut += 1
            if pending_cut >= 2:  # sustained jump => cut, don't pan across the room
                pts.append((t - 0.01, cam_x, cam_y))
                cam_x, cam_y = x, y
                pending_cut = 0
        else:
            pending_cut = 0
            if abs(delta) > dead:
                cam_x += (delta - np.sign(delta) * dead) * 0.5
            cam_y += (y - cam_y) * 0.2
        pts.append((t, cam_x, cam_y))
    simplified = _rdp(pts, eps=0.012)[:80]
    return [{"t": round(t, 3), "x": round(float(x), 4), "y": round(float(y), 4)} for t, x, y in simplified]


def _rdp(pts: list[tuple[float, float, float]], eps: float) -> list[tuple[float, float, float]]:
    """Ramer–Douglas–Peucker on (t, x) to keep only meaningful camera keyframes."""
    if len(pts) < 3:
        return pts
    (t0, x0, _), (t1, x1, _) = pts[0], pts[-1]
    span = max(t1 - t0, 1e-6)
    best_i, best_d = 0, 0.0
    for i in range(1, len(pts) - 1):
        t, x, _ = pts[i]
        d = abs(x - (x0 + (x1 - x0) * (t - t0) / span))
        if d > best_d:
            best_i, best_d = i, d
    if best_d > eps:
        return _rdp(pts[: best_i + 1], eps)[:-1] + _rdp(pts[best_i:], eps)
    return [pts[0], pts[-1]]


def center_at(track: list[dict], t: float) -> tuple[float, float]:
    """Python twin of web/src/lib/crop.ts centerAt()."""
    if not track:
        return 0.5, 0.5
    if t <= track[0]["t"]:
        return track[0]["x"], track[0]["y"]
    for a, b in zip(track, track[1:]):
        if a["t"] <= t <= b["t"]:
            k = (t - a["t"]) / max(1e-6, b["t"] - a["t"])
            return a["x"] + (b["x"] - a["x"]) * k, a["y"] + (b["y"] - a["y"]) * k
    return track[-1]["x"], track[-1]["y"]
