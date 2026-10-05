"""FFmpeg/ffprobe helpers: probing, audio extraction, energy analysis, proxies, thumbnails."""
from __future__ import annotations

import json
import logging
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..config import settings
from ..errors import UserFacingError

log = logging.getLogger(__name__)


def run(cmd: list[str], timeout: float | None = None) -> subprocess.CompletedProcess:
    """Run a command, raising with the tail of stderr on failure."""
    log.debug("exec: %s", " ".join(cmd)[:500])
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="replace")[-1500:]
        raise RuntimeError(f"{Path(cmd[0]).name} failed ({proc.returncode}): {tail}")
    return proc


def ffmpeg_base() -> list[str]:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
    if settings().ffmpeg_threads:
        cmd += ["-threads", str(settings().ffmpeg_threads)]
    return cmd


@dataclass
class ProbeResult:
    duration: float
    width: int
    height: int
    fps: float
    has_audio: bool
    rotation: int = 0


def probe(src: str) -> ProbeResult:
    try:
        out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", src], timeout=120).stdout
    except RuntimeError as e:
        raise UserFacingError("We couldn't read this video file. Is it a valid MP4/MOV/WebM?") from e
    data = json.loads(out)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not video:
        raise UserFacingError("This file has no video track.")
    if not audio:
        raise UserFacingError("This video has no audio track, so there's nothing to transcribe.")
    rate = video.get("avg_frame_rate") or video.get("r_frame_rate") or "30/1"
    num, _, den = rate.partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 30.0
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    w, h = int(video["width"]), int(video["height"])
    # Phone videos often store rotation as metadata; ffmpeg auto-rotates on decode,
    # so report the *displayed* dimensions.
    rotation = 0
    for sd in video.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(sd["rotation"])
    rotation = int(video.get("tags", {}).get("rotate", rotation) or 0)
    if abs(rotation) % 180 == 90:
        w, h = h, w
    if duration <= 0:
        raise UserFacingError("Couldn't determine the video duration.")
    return ProbeResult(duration=duration, width=w, height=h, fps=round(fps, 3), has_audio=True, rotation=rotation)


def extract_audio(src: str, out_wav: Path, start: float | None = None, duration: float | None = None) -> Path:
    """16 kHz mono PCM WAV — what Whisper wants and cheap to analyze."""
    cmd = ffmpeg_base()
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(out_wav)]
    run(cmd)
    return out_wav


def encode_audio_chunk(wav: Path, out: Path, start: float, duration: float) -> Path:
    """Small mono MP3 for cloud transcription upload (~0.36 MB/min at 48 kbps; API limit is 25 MB)."""
    run(ffmpeg_base() + ["-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(wav), "-ac", "1", "-b:a", "48k", str(out)])
    return out


@dataclass
class Energy:
    """Loudness envelope: dB per `hop` seconds, plus normalized z-scores."""
    hop: float
    db: np.ndarray
    z: np.ndarray

    def mean_z(self, start: float, end: float) -> float:
        a, b = int(start / self.hop), max(int(start / self.hop) + 1, int(end / self.hop))
        seg = self.z[a:b]
        return float(seg.mean()) if seg.size else 0.0

    def quietest(self, around: float, radius: float) -> float:
        """Timestamp of the quietest point within ±radius (for silence-aligned splits)."""
        a = max(0, int((around - radius) / self.hop))
        b = min(len(self.db), int((around + radius) / self.hop) + 1)
        if b <= a:
            return around
        return (a + int(np.argmin(self.db[a:b]))) * self.hop


def audio_energy(wav: Path, hop: float = 0.25) -> Energy:
    with wave.open(str(wav), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        raw = wf.readframes(n)
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    win = int(sr * hop)
    frames = len(samples) // win
    if frames == 0:
        return Energy(hop, np.zeros(1), np.zeros(1))
    rms = np.sqrt(np.mean(samples[: frames * win].reshape(frames, win) ** 2, axis=1) + 1e-10)
    db = 20 * np.log10(rms + 1e-10)
    # z-score over non-silent frames so long silences don't skew the baseline.
    voiced = db[db > -50]
    mu, sd = (float(voiced.mean()), float(voiced.std() or 1.0)) if voiced.size else (float(db.mean()), 1.0)
    # Clamp so digital silence (-200 dB) between sentences can't dominate window means.
    return Energy(hop, db, np.clip((db - mu) / sd, -3.0, 3.0))


def make_proxy(src: str, out: Path) -> Path:
    """Low-res, fast-seeking H.264 proxy of the full source for the browser editor.

    The editor applies reframing (CSS crop from the face track) and captions
    (HTML overlay) on top of this, so trims/style changes preview instantly with
    zero server rendering. Keyframe every 1s keeps scrubbing snappy.
    """
    h = settings().proxy_height
    run(ffmpeg_base() + [
        "-i", src,
        "-vf", f"scale=-2:{h}:flags=bilinear,fps=30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-ac", "2",
        "-movflags", "+faststart", str(out),
    ])
    return out


def thumbnail(src: str, t: float, out: Path, src_w: int, src_h: int, cx: float, aspect: float = 9 / 16, width: int = 360) -> Path:
    """Reframed thumbnail JPEG at source time t centred on cx (0..1)."""
    cw = min(src_w, int(round(src_h * aspect)))
    cw -= cw % 2
    x = int(min(max(cx * src_w - cw / 2, 0), src_w - cw))
    run(ffmpeg_base() + [
        "-ss", f"{t:.3f}", "-i", src, "-frames:v", "1",
        "-vf", f"crop={cw}:{src_h}:{x}:0,scale={width}:-2", "-q:v", "4", str(out),
    ])
    return out
