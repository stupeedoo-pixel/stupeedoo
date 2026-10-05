"""REGENERATE_CAPTIONS: re-transcribe just one clip's audio and replace its words."""
from __future__ import annotations

from pathlib import Path

from .. import db, storage
from ..errors import UserFacingError
from ..pipeline import media
from ..pipeline.transcribe import transcribe, words_in
from .common import Reporter

PAD = 1.0


def run(job: dict, rep: Reporter, tmp: Path) -> dict:
    clip = db.q1("SELECT c.*, p.source_key, p.language FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.id = %s", (job["clip_id"],))
    if not clip:
        return {"skipped": "clip deleted"}
    start = max(0.0, clip["start_sec"] - PAD)
    dur = clip["end_sec"] - start + PAD
    rep(10, "Extracting audio", force=True)
    wav = media.extract_audio(storage.ffmpeg_input(clip["source_key"]), tmp / "clip.wav", start=start, duration=dur)
    energy = media.audio_energy(wav)
    tr = transcribe(wav, dur, energy, clip["language"], rep.span(20, 90, "Transcribing clip"))
    words = [{**w, "s": round(w["s"] + start, 3), "e": round(w["e"] + start, 3)} for w in tr.words]
    words = words_in(words, clip["start_sec"], clip["end_sec"])
    if not words:
        raise UserFacingError("No speech detected in this clip.")
    db.q("UPDATE clips SET words = %s, updated_at = now() WHERE id = %s", (db.J(words), clip["id"]))
    return {"words": len(words)}
