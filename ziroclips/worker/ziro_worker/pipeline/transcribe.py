"""Transcription providers producing word-level timestamps.

  openai          OpenAI Whisper API (or any OpenAI-compatible endpoint such as
                  Groq's whisper-large-v3-turbo — set OPENAI_BASE_URL).
                  Long audio is split at the quietest point near each chunk
                  boundary (so words aren't cut) and chunks run in parallel.
  faster_whisper  Self-hosted Whisper large-v3 via CTranslate2. Free per-minute,
                  best on a GPU.
  mock            Offline placeholder words aligned to detected speech, for
                  developing the pipeline/UI without any API key.
"""
from __future__ import annotations

import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..config import settings
from ..errors import UserFacingError
from .media import Energy, encode_audio_chunk

log = logging.getLogger(__name__)

Word = dict  # {"w": str, "s": float, "e": float}
Progress = Callable[[float], None]  # 0..1


@dataclass
class Transcript:
    words: list[Word]
    language: str | None
    provider: str


def transcribe(wav: Path, duration: float, energy: Energy, language: str | None = None, progress: Progress | None = None) -> Transcript:
    provider = settings().transcribe_provider
    lang = None if not language or language == "auto" else language
    progress = progress or (lambda _p: None)
    if provider == "openai":
        t = _openai(wav, duration, energy, lang, progress)
    elif provider == "faster_whisper":
        t = _faster_whisper(wav, duration, lang, progress)
    else:
        t = _mock(duration, energy)
    t.words = _clean(t.words)
    if not t.words:
        raise UserFacingError("We couldn't detect any speech in this video.")
    return t


def _clean(words: list[Word]) -> list[Word]:
    out: list[Word] = []
    for w in sorted(words, key=lambda x: x["s"]):
        text = w["w"].strip()
        if not text:
            continue
        s, e = round(float(w["s"]), 3), round(float(w["e"]), 3)
        if e <= s:
            e = s + 0.08
        if out and s < out[-1]["s"]:  # overlapping duplicates at chunk seams
            continue
        out.append({"w": text, "s": s, "e": e})
    return out


# ------------------------------------------------------------------ openai

def _chunk_bounds(duration: float, energy: Energy) -> list[tuple[float, float]]:
    size = settings().transcribe_chunk_sec
    if duration <= size * 1.2:
        return [(0.0, duration)]
    cuts = [0.0]
    t = size
    while t < duration - size * 0.2:
        cuts.append(energy.quietest(t, radius=15.0))
        t = cuts[-1] + size
    cuts.append(duration)
    return list(zip(cuts[:-1], cuts[1:]))


def _openai(wav: Path, duration: float, energy: Energy, lang: str | None, progress: Progress) -> Transcript:
    from openai import OpenAI

    s = settings()
    if not s.openai_api_key:
        raise UserFacingError("Transcription isn't configured: set OPENAI_API_KEY (or TRANSCRIBE_PROVIDER=faster_whisper).")
    client = OpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url, max_retries=3, timeout=600)
    bounds = _chunk_bounds(duration, energy)
    done = 0
    languages: list[str] = []

    def work(i: int, a: float, b: float) -> list[Word]:
        nonlocal done
        mp3 = wav.parent / f"chunk_{i:03d}.mp3"
        encode_audio_chunk(wav, mp3, a, b - a)
        with mp3.open("rb") as f:
            kwargs = dict(model=s.openai_transcribe_model, file=f, response_format="verbose_json", timestamp_granularities=["word"])
            if lang:
                kwargs["language"] = lang
            res = client.audio.transcriptions.create(**kwargs)
        mp3.unlink(missing_ok=True)
        if getattr(res, "language", None):
            languages.append(res.language)
        words = [{"w": w.word, "s": w.start + a, "e": w.end + a} for w in (res.words or [])]
        words = _restore_punctuation(words, getattr(res, "text", "") or "")
        done += 1
        progress(done / len(bounds))
        return words

    with ThreadPoolExecutor(max_workers=s.transcribe_parallelism) as ex:
        results = list(ex.map(lambda args: work(*args), [(i, a, b) for i, (a, b) in enumerate(bounds)]))
    words = [w for chunk in results for w in chunk]
    return Transcript(words=words, language=(languages[0] if languages else lang), provider=f"openai:{s.openai_transcribe_model}")


_TOKEN = re.compile(r"\S+")


def _restore_punctuation(words: list[Word], text: str) -> list[Word]:
    """Whisper's word list strips punctuation; the full text keeps it. Re-attach
    it by aligning tokens greedily (punctuation drives sentence segmentation)."""
    if not text or not words:
        return words
    tokens = _TOKEN.findall(text)
    norm = lambda s: re.sub(r"[^\w']", "", s.lower())  # noqa: E731
    j = 0
    for w in words:
        target = norm(w["w"])
        for k in range(j, min(j + 4, len(tokens))):
            if norm(tokens[k]) == target:
                w["w"] = tokens[k]
                j = k + 1
                break
    return words


# ------------------------------------------------------------------ faster-whisper

_fw_model = None


def _faster_whisper(wav: Path, duration: float, lang: str | None, progress: Progress) -> Transcript:
    global _fw_model
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise UserFacingError("faster-whisper isn't installed: pip install -r requirements-local-whisper.txt") from e
    s = settings()
    if _fw_model is None:
        _fw_model = WhisperModel(s.whisper_model, device=s.whisper_device, compute_type=s.whisper_compute_type)
    segments, info = _fw_model.transcribe(str(wav), language=lang, word_timestamps=True, vad_filter=True, beam_size=5)
    words: list[Word] = []
    for seg in segments:  # generator: transcription happens while iterating
        for w in seg.words or []:
            words.append({"w": w.word, "s": w.start, "e": w.end})
        progress(min(1.0, seg.end / max(duration, 1)))
    return Transcript(words=words, language=info.language, provider=f"faster_whisper:{s.whisper_model}")


# ------------------------------------------------------------------ mock

_LOREM = (
    "Here's the thing nobody tells you about building something from scratch. "
    "Most people quit right before it starts working. I made every mistake in the book! "
    "So what actually changed? We stopped guessing and started talking to customers every single day. "
    "That one habit doubled our growth in three months. Crazy, right? "
    "If you remember one idea from this video, make it this: speed beats perfection. "
).split()


def _mock(duration: float, energy: Energy) -> Transcript:
    """Deterministic fake speech placed where the audio is actually loud, so
    highlight detection, captions and rendering can be exercised offline."""
    words: list[Word] = []
    t, i = 0.0, 0
    while t < duration - 0.5:
        if energy.mean_z(t, t + 0.4) < -1.5:  # treat as silence
            t += 0.5
            continue
        w = _LOREM[i % len(_LOREM)]
        length = 0.18 + 0.03 * len(w)
        words.append({"w": w, "s": t, "e": min(duration, t + length)})
        t += length + 0.06 + (0.35 if w.endswith((".", "!", "?")) else 0)
        i += 1
    log.warning("TRANSCRIBE_PROVIDER=mock — using placeholder words (%d)", len(words))
    return Transcript(words=words, language="en", provider="mock")


# ------------------------------------------------------------------ segmentation

_SENT_END = re.compile(r"[.!?…][\"')\]]?$")


def segment(words: list[Word], max_words: int = 40, max_gap: float = 1.0) -> list[dict]:
    """Group words into sentence-like segments: [{text, s, e, i0, i1}] (i1 exclusive)."""
    segs: list[dict] = []
    start = 0
    for i, w in enumerate(words):
        nxt = words[i + 1] if i + 1 < len(words) else None
        boundary = (
            nxt is None
            or bool(_SENT_END.search(w["w"]))
            or (nxt["s"] - w["e"]) > max_gap
            or (i - start + 1) >= max_words
        )
        if boundary:
            chunk = words[start : i + 1]
            segs.append({"text": " ".join(x["w"] for x in chunk), "s": chunk[0]["s"], "e": chunk[-1]["e"], "i0": start, "i1": i + 1})
            start = i + 1
    return segs


def words_in(words: list[Word], start: float, end: float) -> list[Word]:
    return [w for w in words if w["s"] >= start - 0.05 and w["e"] <= end + 0.05]


def ceil_minutes(sec: float) -> float:
    return math.ceil(sec / 6) / 10  # round up to 0.1 min
