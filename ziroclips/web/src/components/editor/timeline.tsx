"use client";
import { useRef, useState } from "react";
import { Pause, Play, Scissors, SkipBack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clamp, formatDuration } from "@/lib/utils";
import type { ClipDTO } from "@/lib/types";
import { useClock, type Clock } from "./clock";

const PAD = 20; // seconds of context shown either side of the clip

/**
 * Trim timeline: drag the handles to trim (or extend into the surrounding
 * footage), click to seek, split at the playhead.
 */
export function Timeline({
  clip,
  duration,
  clock,
  videoRef,
  onTrim,
  onSplit,
}: {
  clip: ClipDTO;
  duration: number;
  clock: Clock;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onTrim: (start: number, end: number) => void;
  onSplit: (at: number) => void;
}) {
  const t = useClock(clock);
  const trackRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<{ start: number; end: number } | null>(null);
  const start = live?.start ?? clip.startSec;
  const end = live?.end ?? clip.endSec;
  const winStart = Math.max(0, Math.min(clip.startSec, start) - PAD);
  const winEnd = Math.min(duration || clip.endSec + PAD, Math.max(clip.endSec, end) + PAD);
  const span = Math.max(1, winEnd - winStart);
  const pct = (v: number) => `${((v - winStart) / span) * 100}%`;
  const playing = videoRef.current ? !videoRef.current.paused : false;

  const timeAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return winStart + clamp((clientX - r.left) / r.width, 0, 1) * span;
  };

  const dragHandle = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    let cur = { start, end };
    const move = (ev: PointerEvent) => {
      const v = Math.round(timeAt(ev.clientX) * 10) / 10;
      cur = which === "start" ? { start: clamp(v, 0, cur.end - 1), end: cur.end } : { start: cur.start, end: clamp(v, cur.start + 1, duration || v) };
      setLive(cur);
      if (videoRef.current) videoRef.current.currentTime = which === "start" ? cur.start : Math.max(cur.start, cur.end - 2);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      if (cur.start !== clip.startSec || cur.end !== clip.endSec) onTrim(cur.start, cur.end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const seek = (e: React.PointerEvent) => {
    const v = clamp(timeAt(e.clientX), clip.startSec, clip.endSec - 0.05);
    if (videoRef.current) videoRef.current.currentTime = v;
  };

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="secondary" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause /> : <Play />}</Button>
        <Button size="icon" variant="ghost" onClick={() => videoRef.current && (videoRef.current.currentTime = clip.startSec)} aria-label="Back to start"><SkipBack /></Button>
        <span className="font-mono text-xs tabular-nums text-zinc-400">
          {formatDuration(Math.max(0, t - start))} / {formatDuration(end - start)}
        </span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onTrim(Math.round(t * 10) / 10, clip.endSec)} disabled={clip.endSec - t < 1}>Set start</Button>
          <Button size="sm" variant="ghost" onClick={() => onTrim(clip.startSec, Math.round(t * 10) / 10)} disabled={t - clip.startSec < 1}>Set end</Button>
          <Button size="sm" variant="secondary" onClick={() => onSplit(t)} disabled={t - clip.startSec < 1 || clip.endSec - t < 1}><Scissors /> Split</Button>
        </div>
      </div>
      <div ref={trackRef} onPointerDown={seek} className="relative h-14 cursor-pointer touch-none select-none overflow-hidden rounded-lg bg-zinc-900">
        {/* word ticks (whole transcript within the window is not loaded; show clip words) */}
        {clip.words.map((w, i) => (
          <div key={i} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-zinc-600" style={{ left: pct(w.s) }} />
        ))}
        <div className="absolute inset-y-0 border-y-2 border-accent bg-lime-400/10" style={{ left: pct(start), width: `${((end - start) / span) * 100}%` }}>
          <div onPointerDown={dragHandle("start")} className="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize rounded-l bg-accent" aria-label="Trim start" />
          <div onPointerDown={dragHandle("end")} className="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize rounded-r bg-accent" aria-label="Trim end" />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: pct(t) }} />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-zinc-600">
        <span>{formatDuration(winStart)}</span>
        <span>drag handles to trim · extends into surrounding footage</span>
        <span>{formatDuration(winEnd)}</span>
      </div>
    </div>
  );
}
