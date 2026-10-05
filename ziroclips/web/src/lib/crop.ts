/**
 * Reframing math shared by the editor (CSS transform) and mirrored in the
 * worker's FFmpeg crop expression (worker/ziro_worker/pipeline/render.py).
 */
export interface CropKey {
  t: number; // source seconds
  x: number; // subject centre, 0..1 of source width
  y: number; // subject centre, 0..1 of source height
}

/** Piecewise-linear interpolation of the subject centre at source time t. */
export function centerAt(track: CropKey[], t: number): { x: number; y: number } {
  if (!track?.length) return { x: 0.5, y: 0.5 };
  if (t <= track[0].t) return { x: track[0].x, y: track[0].y };
  const last = track[track.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/**
 * Crop window (normalized to source dims) for a target aspect ratio.
 * Returns left/top/width/height as fractions of the source frame.
 */
export function cropWindow(srcW: number, srcH: number, targetAspect: number, cx: number, cy: number) {
  const srcAspect = srcW / srcH;
  if (targetAspect <= srcAspect) {
    const w = targetAspect / srcAspect; // fraction of width kept
    const left = Math.min(1 - w, Math.max(0, cx - w / 2));
    return { left, top: 0, width: w, height: 1 };
  }
  const h = srcAspect / targetAspect;
  const top = Math.min(1 - h, Math.max(0, cy - h / 2));
  return { left: 0, top, width: 1, height: h };
}
