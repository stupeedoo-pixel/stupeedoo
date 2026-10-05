import { route, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { conflict } from "@/lib/errors";
import { enqueue } from "@/lib/jobs";
import { rateLimit } from "@/lib/ratelimit";
import { ownedClip } from "@/lib/serializers";

/**
 * POST /api/clips/:id/regenerate-captions — re-transcribe just this clip's
 * audio (useful after trimming, or if the long-form pass misheard something).
 * Discards manual word edits for this clip.
 */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await rateLimit(`regen:${user.id}`, 30, 3600);
  const clip = await ownedClip(user.id, params.id);
  const busy = await db.job.findFirst({ where: { clipId: clip.id, type: "REGENERATE_CAPTIONS", status: { in: ["QUEUED", "RUNNING"] } } });
  if (busy) throw conflict("Captions are already being regenerated.");
  const job = await enqueue("REGENERATE_CAPTIONS", { userId: user.id, projectId: clip.projectId, clipId: clip.id, priority: 1 });
  return { jobId: job.id };
});
