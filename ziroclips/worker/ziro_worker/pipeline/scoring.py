"""Virality Score (0-100).

Blends the model's judgement (or heuristic estimates) of five qualities with
measurable signals from the media itself:

  hook strength (first ~3 s)  28%   | LLM/heuristic hook score + opening-line patterns
  completeness of idea        22%   | does it land a full thought?
  engagement potential        22%   | shareability / comment-bait / value
  emotional language          14%
  pacing                      14%   | 50/50 blend of model view and measured words/sec

  + up to ±4 from opening-energy (louder, livelier openings retain better)
  + duration sweet spot (20-60 s: +3; > 75 s: -3)

It's a ranking aid, not a promise. ROADMAP (Phase 2 – analytics): once clips are
published, regress real retention/views against these features per creator to
learn personalised weights.
"""
from __future__ import annotations

import math
import re

from .highlights import Candidate
from .media import Energy
from .transcribe import words_in


def score(c: Candidate, words: list[dict], energy: Energy) -> tuple[int, dict]:
    dur = max(0.1, c.end - c.start)
    clip_words = words_in(words, c.start, c.end)
    wps = len(clip_words) / dur
    first3 = " ".join(w["w"] for w in clip_words if w["s"] < c.start + 3.0)
    opening_z = energy.mean_z(c.start, min(c.end, c.start + 3.0))
    question_hook = bool(re.search(r"\?", first3)) or bool(re.match(r"(?i)(why|how|what|who|imagine|here's)\b", first3.strip()))

    sc = {k: float(c.scores.get(k, 5.0)) for k in ("hook", "emotion", "pacing", "completeness", "engagement")}
    measured_pacing = 10 * math.exp(-(((wps - 3.0) / 1.2) ** 2))
    pacing = 0.5 * sc["pacing"] + 0.5 * measured_pacing
    hook = min(10.0, sc["hook"] + (0.5 if question_hook else 0))

    base = 10 * (0.28 * hook + 0.22 * sc["completeness"] + 0.22 * sc["engagement"] + 0.14 * sc["emotion"] + 0.14 * pacing)
    energy_bonus = max(-4.0, min(4.0, opening_z * 2.0))
    duration_bonus = 3.0 if 20 <= dur <= 60 else (-3.0 if dur > 75 else 0.0)
    total = int(round(max(1.0, min(99.0, base + energy_bonus + duration_bonus))))

    breakdown = {
        **{k: round(v, 1) for k, v in sc.items()},
        "pacing": round(pacing, 1),
        "hook": round(hook, 1),
        "signals": {
            "method": c.method,
            "wordsPerSec": round(wps, 2),
            "openingEnergyZ": round(opening_z, 2),
            "questionHook": question_hook,
            "durationSec": round(dur, 1),
        },
    }
    return total, breakdown
