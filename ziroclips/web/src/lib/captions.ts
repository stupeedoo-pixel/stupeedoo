/**
 * Caption model shared by the editor preview. The Python worker implements the
 * SAME grouping/timing rules in worker/ziro_worker/pipeline/captions.py so the
 * burned-in export matches what you see in the browser. Keep them in sync.
 */
import templatesJson from "@shared/caption-templates.json";

export interface Word {
  w: string;
  s: number; // start, source seconds
  e: number; // end, source seconds
}

export type CaptionAnimation = "none" | "highlight" | "pop";

export interface CaptionTemplate {
  label: string;
  fontFamily: string;
  fontWeight: number;
  fontSizePct: number;
  textColor: string;
  highlightColor: string;
  strokeColor: string;
  strokePct: number;
  shadow: boolean;
  uppercase: boolean;
  positionYPct: number;
  animation: CaptionAnimation;
  wordsPerLine: number;
  emoji: boolean;
  background: string | null;
}

/** Stored on Clip.captionStyle: a template id plus any user overrides. */
export type CaptionStyle = { template: string; enabled?: boolean } & Partial<Omit<CaptionTemplate, "label">>;

export const TEMPLATES = templatesJson.templates as Record<string, CaptionTemplate>;
export const EMOJI_KEYWORDS = templatesJson.emojiKeywords as Record<string, string>;
export const DEFAULT_TEMPLATE = "bold-modern";
export const FONT_CHOICES = ["Montserrat", "Inter", "Poppins", "Bebas Neue", "Anton", "Roboto"];

export function resolveStyle(style: CaptionStyle | null | undefined): CaptionTemplate & { enabled: boolean } {
  const base = TEMPLATES[style?.template ?? DEFAULT_TEMPLATE] ?? TEMPLATES[DEFAULT_TEMPLATE];
  const { template: _t, enabled, ...overrides } = style ?? { template: DEFAULT_TEMPLATE };
  void _t;
  const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return { ...base, ...clean, enabled: enabled ?? true };
}

export interface CaptionPage {
  words: Word[];
  start: number;
  end: number;
}

const SENTENCE_END = /[.!?…]["')\]]?$/;
const MAX_GAP = 0.6;
const HOLD = 0.4;

/** Split words into on-screen "pages" of up to `perLine` words. */
export function groupWords(words: Word[], perLine: number): CaptionPage[] {
  const pages: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    if (cur.length && (cur.length >= perLine || w.s - cur[cur.length - 1].e > MAX_GAP)) {
      pages.push(cur);
      cur = [];
    }
    cur.push(w);
    if (SENTENCE_END.test(w.w)) {
      pages.push(cur);
      cur = [];
    }
  }
  if (cur.length) pages.push(cur);
  return pages.map((ws, i) => {
    const next = pages[i + 1];
    const lastEnd = ws[ws.length - 1].e;
    const end = next ? Math.max(lastEnd, Math.min(lastEnd + HOLD, next[0].s)) : lastEnd + HOLD;
    return { words: ws, start: ws[0].s, end };
  });
}

export function emojiFor(word: string): string | null {
  const k = word.toLowerCase().replace(/[^a-z']/g, "");
  return EMOJI_KEYWORDS[k] ?? null;
}

export function pageEmoji(page: CaptionPage): string | null {
  for (const w of page.words) {
    const e = emojiFor(w.w);
    if (e) return e;
  }
  return null;
}

// ---------------------------------------------------------------- overlays

export type OverlayType = "text" | "emoji" | "broll";

export interface Overlay {
  id: string;
  type: OverlayType;
  text: string;
  /** Centre position, normalized 0..1 of the output frame. */
  x: number;
  y: number;
  /** Clip-relative seconds. */
  start: number;
  end: number;
  /** Fraction of output height. */
  sizePct: number;
  color: string;
}

export const ASPECT_RATIOS = ["9:16", "1:1", "4:5", "16:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export function aspectValue(ar: string): number {
  const [w, h] = ar.split(":").map(Number);
  return w && h ? w / h : 9 / 16;
}
