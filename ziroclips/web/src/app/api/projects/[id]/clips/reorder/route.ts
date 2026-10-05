import { z } from "zod";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { ownedProject } from "@/lib/serializers";

/** POST /api/projects/:id/clips/reorder { ids: string[] } — full ordering. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await ownedProject(user.id, params.id);
  const { ids } = await json(req, z.object({ ids: z.array(z.string()).max(500) }));
  const existing = await db.clip.findMany({ where: { projectId: params.id }, select: { id: true } });
  const known = new Set(existing.map((c) => c.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) throw badRequest("Reorder list must contain every clip exactly once.");
  await db.$transaction(ids.map((id, position) => db.clip.update({ where: { id }, data: { position } })));
  return { ok: true };
});
