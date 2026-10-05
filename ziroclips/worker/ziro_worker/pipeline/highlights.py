"""Highlight detection: pick the most clip-worthy, self-contained moments.

Claude reads the transcript as numbered sentence segments and returns clips as
*segment ranges* — so every clip starts and ends on a sentence boundary by
construction (no mid-sentence cuts). Without an API key a heuristic ranks
windows using hook phrases, audio energy and pacing.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

from pydantic import BaseModel, ValidationError

from ..config import settings
from .media import Energy

log = logging.getLogger(__name__)


@dataclass
class Candidate:
    start: float
    end: float
    title: str
    hook: str = ""
    reasoning: str = ""
    hashtags: list[str] = field(default_factory=list)
    scores: dict[str, float] = field(default_factory=dict)  # hook/emotion/pacing/completeness/engagement 0..10
    method: str = "llm"


@dataclass
class Options:
    count: int = 12
    min_sec: float = 15
    max_sec: float = 90
    exclude: list[tuple[float, float]] = field(default_factory=list)


def target_count(duration: float) -> int:
    """~1 clip per 4 minutes, within 4..20 (a 60-min video -> 15)."""
    return int(min(20, max(4, round(duration / 240))))


def detect(segments: list[dict], energy: Energy, duration: float, opts: Options) -> list[Candidate]:
    s = settings()
    if s.llm_provider == "anthropic" and s.anthropic_api_key:
        try:
            cands = _claude(segments, duration, opts)
            if cands:
                return _finalize(cands, segments, opts)
            log.warning("LLM returned no usable clips; falling back to heuristic")
        except Exception as e:  # degrade gracefully: heuristic clips beat a failed job
            log.warning("LLM highlight detection failed (%s); falling back to heuristic", e)
    elif s.llm_provider == "anthropic":
        log.warning("ANTHROPIC_API_KEY not set; using heuristic highlight detection")
    return _finalize(_heuristic(segments, energy, opts), segments, opts)


# ------------------------------------------------------------------ Claude

SYSTEM_PROMPT = """You are an expert short-form video editor who has cut thousands of viral TikToks, \
YouTube Shorts and Reels from podcasts, interviews, talks and vlogs.

You will receive a transcript split into numbered segments, formatted as:
  [segment_number] (start_seconds-end_seconds) text

Pick the moments that would perform best as standalone vertical short clips. A great clip:
- Opens with a strong hook in the first ~3 seconds: a bold claim, a question, a surprising number, \
conflict, or an emotional moment. Never open on filler ("so", "um", "yeah, and...") or a reference \
to something the viewer hasn't seen.
- Is self-contained: a viewer with zero context understands it and it lands a complete idea, story \
or punchline. It ends on a resolution, punchline or quotable line, not mid-thought.
- Has energy and pacing: little dead air, tight delivery.
- Carries emotion or value: humour, inspiration, controversy, a practical insight, a story.

Rules:
- Each clip is a contiguous range of segments: start_segment..end_segment inclusive.
- Respect the requested duration range (computed from segment times).
- Clips must not overlap each other or any excluded range given.
- Prefer quality over quantity: return fewer clips rather than weak ones.
- Scores are integers 0-10 and must be honest and spread out; reserve 9-10 for genuinely exceptional moments.
- title: punchy on-screen title, max ~60 characters, no hashtags, no clickbait lies.
- hook: the opening line (or a lightly tightened version of it) that grabs attention.
- reasoning: one sentence on why this clip works.
- hashtags: 3-5 relevant lowercase hashtags without the # sign."""


class _Scores(BaseModel):
    hook: int
    emotion: int
    pacing: int
    completeness: int
    engagement: int


class _Clip(BaseModel):
    start_segment: int
    end_segment: int
    title: str
    hook: str
    reasoning: str
    hashtags: list[str]
    scores: _Scores


class _Result(BaseModel):
    clips: list[_Clip]


def _schema() -> dict:
    """JSON schema for structured outputs (every object closed + all keys required)."""
    scores = {
        "type": "object",
        "properties": {k: {"type": "integer"} for k in ("hook", "emotion", "pacing", "completeness", "engagement")},
        "required": ["hook", "emotion", "pacing", "completeness", "engagement"],
        "additionalProperties": False,
    }
    clip = {
        "type": "object",
        "properties": {
            "start_segment": {"type": "integer"},
            "end_segment": {"type": "integer"},
            "title": {"type": "string"},
            "hook": {"type": "string"},
            "reasoning": {"type": "string"},
            "hashtags": {"type": "array", "items": {"type": "string"}},
            "scores": scores,
        },
        "required": ["start_segment", "end_segment", "title", "hook", "reasoning", "hashtags", "scores"],
        "additionalProperties": False,
    }
    return {"type": "object", "properties": {"clips": {"type": "array", "items": clip}}, "required": ["clips"], "additionalProperties": False}


def transcript_block(segments: list[dict]) -> str:
    return "\n".join(f"[{i}] ({seg['s']:.1f}-{seg['e']:.1f}) {seg['text']}" for i, seg in enumerate(segments))


def _claude(segments: list[dict], duration: float, opts: Options) -> list[Candidate]:
    import anthropic

    s = settings()
    client = anthropic.Anthropic(api_key=s.anthropic_api_key, max_retries=3, timeout=600)

    ask = (
        f"Find up to {opts.count} clips, each between {opts.min_sec:.0f} and {opts.max_sec:.0f} seconds long "
        f"(the video is {duration / 60:.1f} minutes)."
    )
    if opts.exclude:
        ranges = ", ".join(f"{a:.1f}-{b:.1f}s" for a, b in opts.exclude)
        ask += f"\nThese ranges are already clipped; do not overlap them: {ranges}. Find different moments."

    # The transcript block is the large, stable part of the prompt. Marking it
    # cacheable means "Find more clips" on the same video re-reads it at ~10% cost.
    response = client.beta.messages.create(
        model=s.llm_model,
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": f"<transcript>\n{transcript_block(segments)}\n</transcript>", "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": ask},
            ],
        }],
        output_config={"effort": s.llm_effort, "format": {"type": "json_schema", "schema": _schema()}},
        # Server-side fallback: if a safety classifier declines, the API retries on
        # a suitable model automatically instead of failing the request.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("model declined the request")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("model output was truncated")
    text = "".join(b.text for b in response.content if b.type == "text")
    try:
        result = _Result.model_validate_json(text)
    except ValidationError as e:
        raise RuntimeError(f"invalid JSON from model: {e}") from e

    u = response.usage
    log.info("LLM highlights: %d clips (in=%s cached=%s out=%s)", len(result.clips), u.input_tokens,
             getattr(u, "cache_read_input_tokens", None), u.output_tokens)

    out: list[Candidate] = []
    for c in result.clips:
        a, b = sorted((c.start_segment, c.end_segment))
        if a < 0 or b >= len(segments):
            continue
        out.append(Candidate(
            start=segments[a]["s"], end=segments[b]["e"], title=c.title.strip()[:120], hook=c.hook.strip(),
            reasoning=c.reasoning.strip(), hashtags=[h.lstrip("#").lower() for h in c.hashtags][:6],
            scores={k: float(max(0, min(10, v))) for k, v in c.scores.model_dump().items()}, method="llm",
        ))
    return out


# ------------------------------------------------------------------ heuristic

HOOK_PATTERNS = [
    r"\?$", r"^(why|how|what|who|when|imagine|here'?s|the (secret|truth|problem|mistake))\b", r"\b(never|always|nobody|everyone|biggest|worst|best)\b",
    r"\b\d+(%|x| percent| million| thousand| years| days)?\b", r"\b(secret|mistake|crazy|insane|shocking|truth|lie|wrong|regret)\b",
    r"^(stop|don'?t|listen|look)\b",
]
EMOTION = r"\b(love|hate|scared|afraid|angry|cried|amazing|incredible|terrible|insane|crazy|funny|laugh|died|fired|broke|million|dream|fail|failed|quit)\b"
FILLER_START = r"^(so|and|but|um+|uh+|yeah|like|okay|ok|right)\b"


def _hook_score(text: str) -> float:
    t = text.lower().strip()
    score = sum(3 for p in HOOK_PATTERNS if re.search(p, t))
    if re.search(FILLER_START, t):
        score -= 3
    return max(0.0, min(10.0, 3 + score))


def _heuristic(segments: list[dict], energy: Energy, opts: Options) -> list[Candidate]:
    scored: list[tuple[float, Candidate]] = []
    target = (opts.min_sec + opts.max_sec) / 2
    for i, first in enumerate(segments):
        # grow the window segment by segment until it's long enough
        for j in range(i, len(segments)):
            dur = segments[j]["e"] - first["s"]
            if dur > opts.max_sec:
                break
            if dur < opts.min_sec:
                continue
            text = " ".join(seg["text"] for seg in segments[i : j + 1])
            words = len(text.split())
            hook = _hook_score(first["text"])
            emotion = min(10.0, 2 + 2 * len(re.findall(EMOTION, text.lower())))
            wps = words / max(dur, 1)
            pacing = max(0.0, 10 - abs(wps - 3.0) * 4)
            completeness = 8.0 if re.search(r"[.!?]$", segments[j]["text"]) else 4.0
            energy_z = energy.mean_z(first["s"], segments[j]["e"])
            engagement = max(0.0, min(10.0, 5 + 2.5 * energy_z + (hook - 5) * 0.3))
            fit = 1 - abs(dur - target) / target  # mild preference for mid-length clips
            total = 0.3 * hook + 0.15 * emotion + 0.15 * pacing + 0.2 * completeness + 0.2 * engagement + fit
            title = first["text"].strip().rstrip(".,!?")
            scored.append((total, Candidate(
                start=first["s"], end=segments[j]["e"], title=(title[:57] + "…") if len(title) > 58 else title,
                hook=first["text"].strip(), reasoning="Selected by on-device heuristics (hook phrases, energy, pacing).",
                scores={"hook": hook, "emotion": emotion, "pacing": pacing, "completeness": completeness, "engagement": engagement},
                method="heuristic",
            )))
    scored.sort(key=lambda x: -x[0])
    chosen: list[Candidate] = []
    for _, c in scored:
        if len(chosen) >= opts.count:
            break
        if not any(_overlaps((c.start, c.end), (o.start, o.end)) for o in chosen) and not any(_overlaps((c.start, c.end), r) for r in opts.exclude):
            chosen.append(c)
    return chosen


# ------------------------------------------------------------------ cleanup

def _overlaps(a: tuple[float, float], b: tuple[float, float], tol: float = 1.0) -> bool:
    return a[0] < b[1] - tol and b[0] < a[1] - tol


def _finalize(cands: list[Candidate], segments: list[dict], opts: Options) -> list[Candidate]:
    """Enforce duration bounds, add natural breathing room, drop overlaps."""
    out: list[Candidate] = []
    seg_starts = [s["s"] for s in segments]
    seg_ends = [s["e"] for s in segments]
    for c in cands:
        # Snap to sentence boundaries in case the model's range was off.
        c.start = min(seg_starts, key=lambda t: abs(t - c.start))
        c.end = min(seg_ends, key=lambda t: abs(t - c.end))
        # Trim overly long clips at the last sentence end that fits.
        if c.end - c.start > opts.max_sec:
            fits = [e for e in seg_ends if c.start + opts.min_sec <= e <= c.start + opts.max_sec]
            c.end = max(fits) if fits else c.start + opts.max_sec
        # Extend short clips by whole sentences.
        if c.end - c.start < opts.min_sec:
            longer = [e for e in seg_ends if e >= c.start + opts.min_sec and e <= c.start + opts.max_sec]
            if not longer:
                continue
            c.end = min(longer)
        # Small lead-in/out so the first syllable and the final beat aren't clipped.
        prev_end = max([e for e in seg_ends if e <= c.start] or [0.0])
        next_start = min([s for s in seg_starts if s >= c.end] or [c.end + 1.0])
        c.start = max(prev_end, c.start - 0.15, 0.0)
        c.end = min(next_start, c.end + 0.35)
        if any(_overlaps((c.start, c.end), (o.start, o.end)) for o in out) or any(_overlaps((c.start, c.end), r) for r in opts.exclude):
            continue
        out.append(c)
    return out[: opts.count]


def debug_dump(cands: list[Candidate]) -> str:
    return json.dumps([c.__dict__ for c in cands], indent=2)
