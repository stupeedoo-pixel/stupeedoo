import { route, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { clipDTO, ownedClip } from "@/lib/serializers";
import type { Word } from "@/lib/captions";
import type { CropKey } from "@/lib/crop";

/**
 * POST /api/clips/:id/merge-next — merge with the next clip in the ordering.
 * The merged clip spans both source ranges (and anything in between).
 */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const a = await ownedClip(user.id, params.id);
  const b = await db.clip.findFirst({ where: { projectId: a.projectId, position: { gt: a.position } }, orderBy: { position: "asc" } });
  if (!b) throw badRequest("There's no next clip to merge with.");
  const start = Math.min(a.startSec, b.startSec);
  const end = Math.max(a.endSec, b.endSec);
  if (end - start > 180) throw badRequest("Merged clip would be longer than 3 minutes.");

  const transcript = await db.transcript.findUnique({ where: { projectId: a.projectId }, select: { words: true } });
  const all = (transcript?.words as unknown as Word[]) ?? [];
  const edited = [...(a.words as unknown as Word[]), ...(b.words as unknown as Word[])];
  const covered = (w: Word) => (w.s >= a.startSec && w.e <= a.endSec) || (w.s >= b.startSec && w.e <= b.endSec);
  const gapWords = all.filter((w) => w.s >= start && w.e <= end && !covered(w));
  const words = [...edited, ...gapWords].sort((x, y) => x.s - y.s);
  const track = [...(a.cropTrack as unknown as CropKey[]), ...(b.cropTrack as unknown as CropKey[])].sort((x, y) => x.t - y.t);

  const merged = await db.$transaction(async (tx) => {
    await tx.clip.delete({ where: { id: b.id } });
    return tx.clip.update({
      where: { id: a.id },
      data: {
        startSec: start,
        endSec: end,
        words: words as never,
        cropTrack: track as never,
        viralityScore: Math.round((a.viralityScore + b.viralityScore) / 2),
      },
    });
  });
  return { clip: await clipDTO(merged) };
});
