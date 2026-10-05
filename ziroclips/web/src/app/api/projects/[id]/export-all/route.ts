import { z } from "zod";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { createExport } from "@/lib/exports";
import { rateLimit } from "@/lib/ratelimit";
import { exportDTO, ownedProject } from "@/lib/serializers";

/** POST /api/projects/:id/export-all { resolution, minScore? } — batch export. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await rateLimit(`export-batch:${user.id}`, 5, 3600);
  const p = await ownedProject(user.id, params.id);
  const body = await json(req, z.object({ resolution: z.enum(["1080p", "4k"]).default("1080p"), minScore: z.number().min(0).max(100).default(0) }));
  const clips = await db.clip.findMany({ where: { projectId: p.id, viralityScore: { gte: body.minScore } }, orderBy: { position: "asc" } });
  const exports = [];
  for (const c of clips) exports.push(await createExport(user, { ...c, project: p }, body.resolution));
  return { exports: await Promise.all(exports.map((e) => exportDTO(e))) };
});
