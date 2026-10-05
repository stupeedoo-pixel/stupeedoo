"use client";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { aspectValue, groupWords, pageEmoji, resolveStyle, type Overlay } from "@/lib/captions";
import { centerAt, cropWindow } from "@/lib/crop";
import { clamp, cn } from "@/lib/utils";
import type { ClipDTO } from "@/lib/types";
import { useClock, type Clock } from "./clock";
import type { BrandPreview, ClipPatch, SourceInfo } from "./types";

/**
 * Live preview: plays the low-res proxy of the WHOLE source and applies the
 * clip's reframe (CSS transform following the face track), captions and
 * overlays in the browser. Every edit is instant — no server render needed.
 * The worker reproduces the same geometry with FFmpeg + libass on export.
 */
export function Preview({
  clip,
  source,
  brand,
  clock,
  videoRef,
  onChange,
}: {
  clip: ClipDTO;
  source: SourceInfo;
  brand: BrandPreview;
  clock: Clock;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onChange: (p: ClipPatch) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 360, h: 640 });
  const ar = aspectValue(clip.aspectRatio);
  const srcAR = source.width / source.height;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drive playback: loop within the clip and publish the playhead.
  const range = useRef({ start: clip.startSec, end: clip.endSec, track: clip.cropTrack, ar, srcAR, box });
  range.current = { start: clip.startSec, end: clip.endSec, track: clip.cropTrack, ar, srcAR, box };
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const r = range.current;
        let t = v.currentTime;
        if (t >= r.end || t < r.start - 0.25) {
          v.currentTime = r.start;
          t = r.start;
          if (!v.paused && t >= r.end) v.pause();
        }
        clock.set(t);
        // Reframe: position the full-frame video so the crop window fills the box.
        const c = centerAt(r.track, t);
        const win = cropWindow(source.width, source.height, r.ar, c.x, c.y);
        if (r.ar <= r.srcAR) {
          const vw = r.box.h * r.srcAR;
          v.style.width = `${vw}px`;
          v.style.height = `${r.box.h}px`;
          v.style.transform = `translate3d(${-win.left * vw}px,0,0)`;
        } else {
          const vh = r.box.w / r.srcAR;
          v.style.width = `${r.box.w}px`;
          v.style.height = `${vh}px`;
          v.style.transform = `translate3d(0,${-win.top * vh}px,0)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock, videoRef, source.width, source.height]);

  // Seek to clip start when switching clips.
  useEffect(() => {
    const v = videoRef.current;
    if (v && (v.currentTime < clip.startSec || v.currentTime > clip.endSec)) v.currentTime = clip.startSec;
  }, [clip.id, clip.startSec, clip.endSec, videoRef]);

  const fitStyle = ar >= 1 ? { width: "100%", aspectRatio: `${ar}` } : { height: "100%", aspectRatio: `${ar}` };

  return (
    <div className="grid h-full w-full place-items-center">
      <div ref={boxRef} className="relative max-h-full max-w-full overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-border" style={fitStyle}>
        {source.proxyUrl ? (
          <video
            ref={videoRef}
            src={source.proxyUrl}
            playsInline
            preload="auto"
            className="absolute left-0 top-0 max-w-none will-change-transform"
            onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())}
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-zinc-500">Preview not available</div>
        )}
        <Captions clip={clip} clock={clock} h={box.h} onMove={(y) => onChange({ captionStyle: { ...clip.captionStyle, positionYPct: y } })} />
        <Overlays clip={clip} clock={clock} w={box.w} h={box.h} onChange={(overlays) => onChange({ overlays })} />
        {brand.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl}
            alt=""
            className="pointer-events-none absolute"
            style={{
              width: box.w * brand.logoScalePct,
              [brand.logoPosition.includes("top") ? "top" : "bottom"]: Math.min(box.w, box.h) * 0.04,
              [brand.logoPosition.includes("left") ? "left" : "right"]: Math.min(box.w, box.h) * 0.04,
            }}
          />
        )}
      </div>
    </div>
  );
}

function Captions({ clip, clock, h, onMove }: { clip: ClipDTO; clock: Clock; h: number; onMove: (yPct: number) => void }) {
  const t = useClock(clock);
  const st = resolveStyle(clip.captionStyle);
  const pages = useMemo(() => groupWords(clip.words, st.wordsPerLine), [clip.words, st.wordsPerLine]);
  const [dragY, setDragY] = useState<number | null>(null);
  if (!st.enabled) return null;
  const page = pages.find((p) => p.start <= t && t < p.end);
  if (!page) return null;
  const active = page.words.reduce((acc, w, i) => (w.s <= t ? i : acc), 0);
  const fontPx = h * st.fontSizePct;
  const y = dragY ?? st.positionYPct;
  const emoji = st.emoji ? pageEmoji(page) : null;

  const onPointerDown = (e: RPointerEvent) => {
    const parent = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setDragY(clamp((ev.clientY - parent.top) / parent.height, 0.08, 0.92));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragY(null);
      onMove(Math.round(clamp((ev.clientY - parent.top) / parent.height, 0.08, 0.92) * 100) / 100);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute left-1/2 w-[86%] -translate-x-1/2 -translate-y-1/2 cursor-ns-resize select-none text-center leading-[1.15]"
      style={{ top: `${y * 100}%`, fontFamily: `"${st.fontFamily}", Inter, sans-serif`, fontWeight: st.fontWeight, fontSize: fontPx }}
      title="Drag to move captions"
    >
      {emoji && <div style={{ fontSize: fontPx * 1.2, marginBottom: fontPx * 0.15 }}>{emoji}</div>}
      <span
        className="caption-stroke"
        style={{
          color: st.textColor,
          WebkitTextStroke: st.background ? undefined : `${Math.max(1, h * st.strokePct * 2)}px ${st.strokeColor}`,
          textShadow: st.shadow ? `0 ${h * 0.003}px ${h * 0.006}px rgba(0,0,0,.6)` : undefined,
          background: st.background ? hexToRgba(st.background) : undefined,
          padding: st.background ? `${fontPx * 0.08}px ${fontPx * 0.25}px` : undefined,
          borderRadius: st.background ? fontPx * 0.15 : undefined,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {page.words.map((w, i) => {
          const isActive = st.animation !== "none" && i === active;
          return (
            <span key={`${w.s}-${i}`}>
              <span
                className="inline-block transition-transform duration-100"
                style={{ color: isActive ? st.highlightColor : undefined, transform: isActive && st.animation === "pop" ? "scale(1.12)" : undefined }}
              >
                {st.uppercase ? w.w.toUpperCase() : w.w}
              </span>
              {i < page.words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </span>
    </div>
  );
}

function Overlays({ clip, clock, w, h, onChange }: { clip: ClipDTO; clock: Clock; w: number; h: number; onChange: (o: Overlay[]) => void }) {
  const t = useClock(clock) - clip.startSec;
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const visible = clip.overlays.filter((o) => o.start <= t && t <= o.end);

  const start = (o: Overlay, e: RPointerEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const pos = (ev: PointerEvent) => ({ x: clamp((ev.clientX - rect.left) / rect.width, 0, 1), y: clamp((ev.clientY - rect.top) / rect.height, 0, 1) });
    const move = (ev: PointerEvent) => setDrag({ id: o.id, ...pos(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const p = pos(ev);
      setDrag(null);
      onChange(clip.overlays.map((x) => (x.id === o.id ? { ...x, x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 } : x)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      {visible.map((o) => {
        const x = drag?.id === o.id ? drag.x : o.x;
        const y = drag?.id === o.id ? drag.y : o.y;
        const common = "absolute -translate-x-1/2 -translate-y-1/2 cursor-move select-none";
        if (o.type === "broll") {
          return (
            <div
              key={o.id}
              onPointerDown={(e) => start(o, e)}
              className={cn(common, "grid place-items-center rounded-md border-2 border-dashed border-zinc-400/60 bg-zinc-900/75 text-center font-semibold text-zinc-200")}
              style={{ left: x * w, top: y * h, width: w * 0.84, height: h * 0.3, fontSize: h * 0.03 }}
            >
              B-ROLL: {o.text}
            </div>
          );
        }
        return (
          <div
            key={o.id}
            onPointerDown={(e) => start(o, e)}
            className={cn(common, "whitespace-nowrap font-extrabold caption-stroke")}
            style={{
              left: x * w,
              top: y * h,
              fontSize: o.sizePct * h,
              color: o.color,
              fontFamily: "Montserrat, Inter, sans-serif",
              WebkitTextStroke: o.type === "text" ? `${Math.max(1, h * 0.003)}px #000` : undefined,
            }}
          >
            {o.text}
          </div>
        );
      })}
    </>
  );
}

function hexToRgba(hex: string): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}
