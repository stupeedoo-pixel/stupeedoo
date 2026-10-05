"use client";
import { useEffect, useState } from "react";
import { Download, Film, Loader2, Plus, RefreshCw, Smile, Trash2, Type } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client";
import { ASPECT_RATIOS, FONT_CHOICES, TEMPLATES, resolveStyle, type CaptionStyle, type Overlay } from "@/lib/captions";
import { cn, formatBytes } from "@/lib/utils";
import type { ClipDTO, ExportDTO } from "@/lib/types";
import type { ClipPatch } from "./types";

type PanelProps = { clip: ClipDTO; onChange: (p: ClipPatch) => void };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer bg-transparent" />
      <span className="font-mono text-xs text-zinc-500">{value.slice(0, 7)}</span>
    </div>
  );
}

// ------------------------------------------------------------------ captions

export function CaptionsPanel({ clip, onChange, regenerating, onRegenerate }: PanelProps & { regenerating: boolean; onRegenerate: () => void }) {
  const st = resolveStyle(clip.captionStyle);
  const set = (p: Partial<CaptionStyle>) => onChange({ captionStyle: { ...clip.captionStyle, ...p } });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Label>Show captions</Label>
        <Switch checked={st.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(TEMPLATES).map(([id, t]) => (
          <button
            key={id}
            onClick={() => onChange({ captionStyle: { template: id, enabled: st.enabled } })}
            className={cn(
              "rounded-lg border bg-zinc-900 px-2 py-3 text-center transition-colors",
              clip.captionStyle.template === id ? "border-accent" : "border-border hover:border-zinc-600",
            )}
          >
            <span
              className="caption-stroke block text-sm"
              style={{ fontFamily: t.fontFamily, fontWeight: t.fontWeight, color: t.textColor, WebkitTextStroke: `1px ${t.strokeColor}`, background: t.background ?? undefined }}
            >
              {t.uppercase ? "THE " : "The "}
              <span style={{ color: t.highlightColor }}>{t.uppercase ? "HOOK" : "hook"}</span>
              {t.emoji ? " 🔥" : ""}
            </span>
            <span className="mt-1 block text-[10px] text-zinc-500">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Row label="Font">
          <Select value={st.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
            {FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}
          </Select>
        </Row>
        <Row label="Animation">
          <Select value={st.animation} onChange={(e) => set({ animation: e.target.value as CaptionStyle["animation"] })}>
            <option value="pop">Pop</option>
            <option value="highlight">Highlight</option>
            <option value="none">None</option>
          </Select>
        </Row>
      </div>
      <Row label={`Size · ${Math.round(st.fontSizePct * 1000) / 10}%`}>
        <Slider min={2} max={9} step={0.1} value={[st.fontSizePct * 100]} onValueChange={([v]) => set({ fontSizePct: Math.round(v * 10) / 1000 })} />
      </Row>
      <Row label={`Words per line · ${st.wordsPerLine}`}>
        <Slider min={1} max={8} step={1} value={[st.wordsPerLine]} onValueChange={([v]) => set({ wordsPerLine: v })} />
      </Row>
      <Row label={`Vertical position · ${Math.round(st.positionYPct * 100)}% (or drag in preview)`}>
        <Slider min={8} max={92} step={1} value={[st.positionYPct * 100]} onValueChange={([v]) => set({ positionYPct: v / 100 })} />
      </Row>
      <div className="grid grid-cols-2 gap-4">
        <Row label="Text"><Color value={st.textColor} onChange={(v) => set({ textColor: v })} /></Row>
        <Row label="Highlight"><Color value={st.highlightColor} onChange={(v) => set({ highlightColor: v })} /></Row>
        <Row label="Outline"><Color value={st.strokeColor} onChange={(v) => set({ strokeColor: v })} /></Row>
        <Row label="Background box">
          <div className="flex items-center gap-2">
            <Switch checked={!!st.background} onCheckedChange={(v) => set({ background: v ? "#000000CC" : null })} />
            {st.background && <Color value={st.background} onChange={(v) => set({ background: `${v}CC` })} />}
          </div>
        </Row>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm"><Switch checked={st.uppercase} onCheckedChange={(v) => set({ uppercase: v })} /> UPPERCASE</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={st.emoji} onCheckedChange={(v) => set({ emoji: v })} /> Auto emoji</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={st.shadow} onCheckedChange={(v) => set({ shadow: v })} /> Shadow</label>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <Label>Transcript ({clip.words.length} words)</Label>
          <Button size="sm" variant="ghost" onClick={onRegenerate} disabled={regenerating}>
            {regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />} Regenerate
          </Button>
        </div>
        <p className="text-xs text-zinc-500">Click a word to fix it. Clear a word to remove it.</p>
        <div className="scrollbar-thin flex max-h-56 flex-wrap gap-1 overflow-y-auto rounded-lg bg-zinc-900 p-2">
          {clip.words.map((w, i) => (
            <input
              key={`${w.s}-${i}`}
              defaultValue={w.w}
              size={Math.max(2, w.w.length)}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v === w.w) return;
                const words = v ? clip.words.map((x, j) => (j === i ? { ...x, w: v } : x)) : clip.words.filter((_, j) => j !== i);
                onChange({ words });
              }}
              className="rounded bg-transparent px-1 text-sm text-zinc-200 outline-none hover:bg-zinc-800 focus:bg-zinc-800 focus:ring-1 focus:ring-accent/50"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ overlays

const EMOJIS = ["🔥", "😂", "🤯", "💰", "🚀", "❤️", "👀", "💡", "✅", "❌", "⚠️", "🎯", "💪", "🙌", "😱", "🤔", "👇", "⭐", "📈", "🏆"];

export function ElementsPanel({ clip, onChange }: PanelProps) {
  const dur = clip.endSec - clip.startSec;
  const add = (o: Omit<Overlay, "id" | "start" | "end">) =>
    onChange({ overlays: [...clip.overlays, { ...o, id: crypto.randomUUID().slice(0, 8), start: 0, end: Math.min(dur, 3) }] });
  const update = (id: string, p: Partial<Overlay>) => onChange({ overlays: clip.overlays.map((o) => (o.id === id ? { ...o, ...p } : o)) });
  const [emojiOpen, setEmojiOpen] = useState(false);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" size="sm" onClick={() => add({ type: "text", text: "Your text", x: 0.5, y: 0.15, sizePct: 0.035, color: "#FFFFFF" })}><Type /> Text</Button>
        <Button variant="secondary" size="sm" onClick={() => setEmojiOpen((v) => !v)}><Smile /> Emoji</Button>
        <Button variant="secondary" size="sm" onClick={() => add({ type: "broll", text: "describe the shot", x: 0.5, y: 0.35, sizePct: 0.03, color: "#FFFFFF" })}><Film /> B-roll</Button>
      </div>
      {emojiOpen && (
        <div className="grid grid-cols-10 gap-1 rounded-lg bg-zinc-900 p-2">
          {EMOJIS.map((e) => (
            <button key={e} className="rounded p-1 text-lg hover:bg-zinc-800" onClick={() => { add({ type: "emoji", text: e, x: 0.75, y: 0.3, sizePct: 0.06, color: "#FFFFFF" }); setEmojiOpen(false); }}>
              {e}
            </button>
          ))}
        </div>
      )}
      {clip.overlays.length === 0 && <p className="text-sm text-zinc-500">Add text, emoji or a B-roll placeholder, then drag it in the preview.</p>}
      <div className="space-y-3">
        {clip.overlays.map((o) => (
          <div key={o.id} className="space-y-3 rounded-lg border border-border bg-zinc-900/60 p-3">
            <div className="flex items-center gap-2">
              <Badge>{o.type === "broll" ? "B-roll" : o.type}</Badge>
              <Input value={o.text} onChange={(e) => update(o.id, { text: e.target.value })} className="h-8" maxLength={o.type === "emoji" ? 8 : 200} />
              <Button size="icon" variant="ghost" onClick={() => onChange({ overlays: clip.overlays.filter((x) => x.id !== o.id) })} aria-label="Remove"><Trash2 /></Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Row label="From (s)"><Input type="number" step={0.1} min={0} max={dur} value={o.start} onChange={(e) => update(o.id, { start: Math.max(0, Number(e.target.value)) })} className="h-8" /></Row>
              <Row label="To (s)"><Input type="number" step={0.1} min={0} max={dur} value={o.end} onChange={(e) => update(o.id, { end: Math.min(dur, Number(e.target.value)) })} className="h-8" /></Row>
              {o.type === "text" ? <Row label="Color"><Color value={o.color} onChange={(v) => update(o.id, { color: v })} /></Row> : <div />}
            </div>
            {o.type !== "broll" && (
              <Row label="Size">
                <Slider min={1.5} max={15} step={0.5} value={[o.sizePct * 100]} onValueChange={([v]) => update(o.id, { sizePct: v / 100 })} />
              </Row>
            )}
          </div>
        ))}
      </div>
      {/* ROADMAP (Phase 2): auto B-roll — match transcript keywords to Pexels/Storyblocks clips and fill placeholders. */}
    </div>
  );
}

// ------------------------------------------------------------------ format / details

export function FormatPanel({ clip, onChange }: PanelProps) {
  const b = clip.scoreBreakdown;
  const bars: [string, number][] = [["Hook", b.hook], ["Completeness", b.completeness], ["Engagement", b.engagement], ["Emotion", b.emotion], ["Pacing", b.pacing]];
  return (
    <div className="space-y-5">
      <Row label="Title">
        <Input defaultValue={clip.title} key={clip.id} onBlur={(e) => e.target.value.trim() && e.target.value !== clip.title && onChange({ title: e.target.value.trim() })} />
      </Row>
      <Row label="Aspect ratio">
        <div className="grid grid-cols-4 gap-2">
          {ASPECT_RATIOS.map((ar) => {
            const [w, h] = ar.split(":").map(Number);
            return (
              <button
                key={ar}
                onClick={() => onChange({ aspectRatio: ar })}
                className={cn("grid place-items-center gap-1 rounded-lg border py-2 text-xs", clip.aspectRatio === ar ? "border-accent text-white" : "border-border text-zinc-400 hover:border-zinc-600")}
              >
                <span className="rounded-sm border border-current" style={{ width: (w / Math.max(w, h)) * 22, height: (h / Math.max(w, h)) * 22 }} />
                {ar}
              </button>
            );
          })}
        </div>
      </Row>
      <div className="space-y-3 rounded-lg border border-border bg-zinc-900/60 p-4">
        <div className="flex items-baseline justify-between">
          <Label>Virality Score</Label>
          <span className="text-2xl font-bold text-accent tabular-nums">{clip.viralityScore}</span>
        </div>
        {bars.map(([k, v]) => (
          <div key={k} className="space-y-1">
            <div className="flex justify-between text-xs text-zinc-400"><span>{k}</span><span className="tabular-nums">{v?.toFixed?.(1) ?? v}/10</span></div>
            <div className="h-1 rounded-full bg-zinc-800"><div className="h-full rounded-full bg-accent/80" style={{ width: `${(v / 10) * 100}%` }} /></div>
          </div>
        ))}
        {b.signals && (
          <p className="pt-1 text-[11px] text-zinc-500">
            {String(b.signals.wordsPerSec)} words/s · opening energy {Number(b.signals.openingEnergyZ) >= 0 ? "+" : ""}{String(b.signals.openingEnergyZ)}σ · {String(b.signals.method)} picks
          </p>
        )}
        {clip.reasoning && <p className="text-sm text-zinc-300">{clip.reasoning}</p>}
        {clip.hashtags.length > 0 && <p className="text-xs text-sky-300">{clip.hashtags.map((h) => `#${h}`).join(" ")}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ export

export function ExportPanel({ clip, allow4k, flush }: { clip: ClipDTO; allow4k: boolean; flush: () => Promise<void> }) {
  const [resolution, setResolution] = useState<"1080p" | "4k">("1080p");
  const [exports, setExports] = useState<ExportDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const pending = exports.some((e) => e.status === "QUEUED" || e.status === "RENDERING");

  useEffect(() => {
    let alive = true;
    const load = () => api<{ exports: ExportDTO[] }>(`/api/clips/${clip.id}/exports`).then((r) => alive && setExports(r.exports)).catch(() => {});
    load();
    if (!pending) return () => { alive = false; };
    const id = setInterval(load, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [clip.id, pending]);

  async function start() {
    setBusy(true);
    try {
      await flush(); // make sure the latest edits are saved before snapshotting
      const r = await api<{ export: ExportDTO }>(`/api/clips/${clip.id}/exports`, { method: "POST", json: { resolution } });
      setExports((e) => [r.export, ...e]);
      toast.success("Export started");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Row label="Resolution">
        <div className="grid grid-cols-2 gap-2">
          {(["1080p", "4k"] as const).map((r) => (
            <button
              key={r}
              disabled={r === "4k" && !allow4k}
              onClick={() => setResolution(r)}
              className={cn("rounded-lg border py-2.5 text-sm disabled:opacity-40", resolution === r ? "border-accent" : "border-border hover:border-zinc-600")}
            >
              {r === "1080p" ? "1080p HD" : "4K UHD"}{r === "4k" && !allow4k && " · Pro"}
            </button>
          ))}
        </div>
      </Row>
      <Button className="w-full" size="lg" loading={busy} onClick={start}><Download /> Export MP4</Button>
      <p className="text-xs text-zinc-500">Captions, overlays and your brand logo are burned in; audio is normalised to -14 LUFS for social platforms. 4K from sub-4K sources is upscaled.</p>
      <div className="space-y-2">
        {exports.map((e) => (
          <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-zinc-900/60 px-3 py-2 text-sm">
            <Badge tone={e.status === "DONE" ? "accent" : e.status === "FAILED" ? "danger" : "info"}>{e.resolution}</Badge>
            <span className="flex-1 text-xs text-zinc-400">
              {e.status === "DONE" ? (e.downloadUrl ? `Ready · ${formatBytes(e.sizeBytes ?? 0)}` : "Expired — export again") : e.status === "FAILED" ? e.error ?? "Failed" : e.status === "RENDERING" ? "Rendering…" : "Queued…"}
            </span>
            {e.status === "DONE" && e.downloadUrl && (
              <Button asChild size="sm"><a href={e.downloadUrl} download><Download /> Download</a></Button>
            )}
            {(e.status === "QUEUED" || e.status === "RENDERING") && <Loader2 className="size-4 animate-spin text-zinc-500" />}
          </div>
        ))}
      </div>
      {/* ROADMAP (Phase 2 – social publishing): "Post to TikTok / YouTube Shorts / Reels" with scheduling, via OAuth connections. */}
      <Button variant="outline" className="w-full" disabled><Plus /> Publish to socials (coming soon)</Button>
    </div>
  );
}
