import { z } from "zod";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { clipDTO, ownedClip } from "@/lib/serializers";
import type { Word } from "@/lib/captions";
import type { CropKey } from "@/lib/crop";

/** POST /api/clips/:id/split { at } — split at a SOURCE timestamp into two clips. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const clip = await ownedClip(user.id, params.id);
  const { at } = await json(req, z.object({ at: z.number() }));
  if (at - clip.startSec < 1 || clip.endSec - at < 1) throw badRequest("Each half must be at least 1 second long.");
  const words = clip.words as unknown as Word[];
  const track = clip.cropTrack as unknown as CropKey[];

  const [, second] = await db.$transaction(async (tx) => {
    await tx.clip.updateMany({ where: { projectId: clip.projectId, position: { gt: clip.position } }, data: { position: { increment: 1 } } });
    const a = await tx.clip.update({
      where: { id: clip.id },
      data: { endSec: at, words: words.filter((w) => w.s < at) as never },
    });
    const b = await tx.clip.create({
      data: {
        projectId: clip.projectId,
        position: clip.position + 1,
        title: `${clip.title} (part 2)`,
        hook: null,
        reasoning: clip.reasoning,
        hashtags: clip.hashtags,
        startSec: at,
        endSec: clip.endSec,
        viralityScore: Math.max(0, clip.viralityScore - 10), // second halves rarely have the hook
        scoreBreakdown: clip.scoreBreakdown as never,
        words: words.filter((w) => w.s >= at) as never,
        cropTrack: track as never,
        captionStyle: clip.captionStyle as never,
        overlays: [],
        aspectRatio: clip.aspectRatio,
        thumbnailKey: clip.thumbnailKey,
      },
    });
    return [a, b];
  });
  return { clip: await clipDTO(second) };
});
