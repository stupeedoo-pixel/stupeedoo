import { z } from "zod";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { createExport } from "@/lib/exports";
import { rateLimit } from "@/lib/ratelimit";
import { exportDTO, ownedClip } from "@/lib/serializers";

type P = { id: string };

/** GET /api/clips/:id/exports — export history (with signed download URLs). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const clip = await ownedClip(user.id, params.id);
  const exports = await db.export.findMany({ where: { clipId: clip.id }, orderBy: { createdAt: "desc" }, take: 20 });
  return { exports: await Promise.all(exports.map((e) => exportDTO(e, clip.title))) };
});

/** POST /api/clips/:id/exports { resolution } — render an MP4. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  await rateLimit(`export:${user.id}`, 60, 3600);
  const clip = await ownedClip(user.id, params.id);
  const { resolution } = await json(req, z.object({ resolution: z.enum(["1080p", "4k"]).default("1080p") }));
  const exp = await createExport(user, clip, resolution);
  return { export: await exportDTO(exp, clip.title) };
});
