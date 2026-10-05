import { route, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { exportDTO } from "@/lib/serializers";

/** GET /api/exports/:id — poll a render. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const e = await db.export.findFirst({ where: { id: params.id, userId: user.id }, include: { clip: { select: { title: true } } } });
  if (!e) throw notFound("Export");
  return { export: await exportDTO(e, e.clip.title) };
});
