import "server-only";
import type { Clip, Project, User } from "@prisma/client";
import { db } from "./db";
import { limitReached } from "./errors";
import { enqueue } from "./jobs";
import { PLAN_LIMITS } from "./plans";

export type Resolution = "1080p" | "4k";

/**
 * Create an Export row with an immutable snapshot of the clip's edits + brand
 * kit, then enqueue the render job. The worker renders from the snapshot, so
 * editing a clip while it renders never produces a half-edited video.
 */
export async function createExport(user: User, clip: Clip & { project: Project }, resolution: Resolution) {
  const limits = PLAN_LIMITS[user.plan];
  if (!limits.exportResolutions.includes(resolution)) {
    throw limitReached(`${resolution.toUpperCase()} export isn't included in the ${limits.label} plan.`);
  }
  const brand = await db.brandKit.findUnique({ where: { userId: user.id } });
  const snapshot = {
    startSec: clip.startSec,
    endSec: clip.endSec,
    words: clip.words,
    cropTrack: clip.cropTrack,
    captionStyle: clip.captionStyle,
    overlays: clip.overlays,
    aspectRatio: clip.aspectRatio,
    title: clip.title,
    brand: brand
      ? { logoKey: brand.logoKey, logoPosition: brand.logoPosition, logoScalePct: brand.logoScalePct }
      : null,
    watermark: limits.watermark,
  };
  return db.$transaction(async (tx) => {
    const exp = await tx.export.create({ data: { clipId: clip.id, userId: user.id, resolution, snapshot } });
    await enqueue(
      "EXPORT_CLIP",
      { userId: user.id, projectId: clip.projectId, clipId: clip.id, payload: { exportId: exp.id }, priority: 1 },
      tx,
    );
    return exp;
  });
}
