"""Animated word-by-word captions as ASS subtitles (burned in by libass).

Mirrors web/src/lib/captions.ts — same templates file, same word grouping and
page timing — so the export matches the editor preview.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache

from ..config import settings

SENTENCE_END = re.compile(r"[.!?…][\"')\]]?$")
MAX_GAP = 0.6
HOLD = 0.4
DEFAULT_TEMPLATE = "bold-modern"


@lru_cache
def _templates() -> dict:
    return json.loads(settings().captions_templates_path.read_text())


def resolve_style(style: dict | None) -> dict:
    style = dict(style or {})
    tpl = _templates()["templates"]
    base = dict(tpl.get(style.pop("template", DEFAULT_TEMPLATE), tpl[DEFAULT_TEMPLATE]))
    enabled = style.pop("enabled", True)
    base.update({k: v for k, v in style.items() if v is not None or k == "background"})
    base["enabled"] = enabled if enabled is not None else True
    return base


def emoji_for(word: str) -> str | None:
    k = re.sub(r"[^a-z']", "", word.lower())
    return _templates()["emojiKeywords"].get(k)


@dataclass
class Page:
    words: list[dict]
    start: float
    end: float


def group_words(words: list[dict], per_line: int) -> list[Page]:
    pages: list[list[dict]] = []
    cur: list[dict] = []
    for w in words:
        if cur and (len(cur) >= per_line or w["s"] - cur[-1]["e"] > MAX_GAP):
            pages.append(cur)
            cur = []
        cur.append(w)
        if SENTENCE_END.search(w["w"]):
            pages.append(cur)
            cur = []
    if cur:
        pages.append(cur)
    out: list[Page] = []
    for i, ws in enumerate(pages):
        nxt = pages[i + 1] if i + 1 < len(pages) else None
        last_end = ws[-1]["e"]
        end = max(last_end, min(last_end + HOLD, nxt[0]["s"])) if nxt else last_end + HOLD
        out.append(Page(ws, ws[0]["s"], end))
    return out


# ------------------------------------------------------------------ ASS helpers

def ass_color(hex_color: str) -> str:
    """#RRGGBB[AA] -> &HAABBGGRR (ASS alpha is inverted: 00 = opaque)."""
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    a = 255 - int(h[6:8], 16) if len(h) == 8 else 0
    return f"&H{a:02X}{b}{g}{r}".upper()


def ass_time(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def ass_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


@dataclass
class EmojiEvent:
    emoji: str
    start: float  # clip-relative
    end: float
    x: float      # px centre
    y: float
    size: int     # px


def build_ass(words: list[dict], clip_start: float, clip_end: float, style: dict, overlays: list[dict], W: int, H: int) -> tuple[str, list[EmojiEvent]]:
    """Return (ASS document, emoji overlay events). Times in the ASS are clip-relative."""
    st = resolve_style(style)
    font_px = max(12, round(H * st["fontSizePct"]))
    outline = round(H * st["strokePct"], 1)
    bold = -1 if st.get("fontWeight", 700) >= 600 else 0
    has_box = bool(st.get("background"))
    margin = round(W * 0.07)

    styles = [
        "Style: Cap,{font},{size},{primary},&H000000FF,{outline_c},{back},{bold},0,0,0,100,100,0,0,{bs},{ol},{sh},5,{m},{m},0,1".format(
            font=st["fontFamily"], size=font_px, primary=ass_color(st["textColor"]), outline_c=ass_color(st["strokeColor"]) if not has_box else ass_color(st["background"]),
            back=ass_color(st["background"]) if has_box else "&H80000000", bold=bold, bs=3 if has_box else 1,
            ol=round(H * 0.008) if has_box else outline, sh=(round(H * 0.002) if st.get("shadow") else 0), m=margin),
        f"Style: Ovl,{st['fontFamily']},{font_px},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{max(1, round(H * 0.003))},0,5,0,0,0,1",
    ]
    events: list[str] = []
    emojis: list[EmojiEvent] = []
    cx, cy = W / 2, H * st["positionYPct"]

    def rel(t: float) -> float:
        return min(max(t - clip_start, 0.0), clip_end - clip_start)

    if st["enabled"] and words:
        hl = ass_color(st["highlightColor"])
        base_c = ass_color(st["textColor"])
        anim = st.get("animation", "pop")
        for page in group_words(words, int(st["wordsPerLine"])):
            if page.end <= clip_start or page.start >= clip_end:
                continue
            texts = [ass_escape(w["w"].upper() if st["uppercase"] else w["w"]) for w in page.words]
            pos = f"{{\\an5\\pos({cx:.0f},{cy:.0f})}}"
            if anim == "none":
                events.append(f"Dialogue: 1,{ass_time(rel(page.start))},{ass_time(rel(page.end))},Cap,,0,0,0,,{pos}{' '.join(texts)}")
            else:
                for k, w in enumerate(page.words):
                    a = w["s"] if k else page.start
                    b = page.words[k + 1]["s"] if k + 1 < len(page.words) else page.end
                    parts = []
                    for j, t in enumerate(texts):
                        if j == k:
                            fx = f"\\c{hl}"
                            if anim == "pop":
                                fx += "\\fscx100\\fscy100\\t(0,90,\\fscx116\\fscy116)\\t(90,180,\\fscx108\\fscy108)"
                            parts.append(f"{{{fx}}}{t}{{\\c{base_c}\\fscx100\\fscy100}}")
                        else:
                            parts.append(t)
                    events.append(f"Dialogue: 1,{ass_time(rel(a))},{ass_time(rel(b))},Cap,,0,0,0,,{pos}{' '.join(parts)}")
            if st.get("emoji"):
                e = next((emoji_for(w["w"]) for w in page.words if emoji_for(w["w"])), None)
                if e:
                    emojis.append(EmojiEvent(e, rel(page.start), rel(page.end), cx, cy - font_px * 1.5, int(font_px * 1.4)))

    for o in overlays or []:
        a, b = max(0.0, float(o["start"])), min(clip_end - clip_start, float(o["end"]))
        if b <= a:
            continue
        x, y, size = o["x"] * W, o["y"] * H, max(10, round(o["sizePct"] * H))
        if o["type"] == "emoji":
            emojis.append(EmojiEvent(o["text"], a, b, x, y, size))
        elif o["type"] == "text":
            events.append(f"Dialogue: 2,{ass_time(a)},{ass_time(b)},Ovl,,0,0,0,,{{\\an5\\pos({x:.0f},{y:.0f})\\fs{size}\\c{ass_color(o['color'])}}}{ass_escape(o['text'])}")
        elif o["type"] == "broll":
            # Placeholder card where stock B-roll will go.
            # ROADMAP (Phase 2): fetch matching stock footage (Pexels API) by keyword and overlay it here.
            bw, bh = W * 0.84, H * 0.3
            x0, y0 = x - bw / 2, y - bh / 2
            events.append(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Ovl,,0,0,0,,{{\\an7\\pos({x0:.0f},{y0:.0f})\\bord0\\shad0\\1c&H302A27&\\1a&H30&\\p1}}m 0 0 l {bw:.0f} 0 {bw:.0f} {bh:.0f} 0 {bh:.0f}{{\\p0}}")
            events.append(f"Dialogue: 1,{ass_time(a)},{ass_time(b)},Ovl,,0,0,0,,{{\\an5\\pos({x:.0f},{y:.0f})\\fs{round(H * 0.03)}}}B-ROLL: {ass_escape(o['text'])}")

    doc = "\n".join([
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        *styles, "",
        "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *events, "",
    ])
    return doc, emojis
