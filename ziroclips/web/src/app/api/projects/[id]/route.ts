import { z } from "zod";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { activeJobs } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { clipDTO, ownedProject, projectDTO } from "@/lib/serializers";
import { abortUpload, deletePrefix } from "@/lib/storage";

type P = { id: string };

/** GET /api/projects/:id — project + clips + active jobs. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  await ownedProject(user.id, params.id);
  const project = await db.project.findUniqueOrThrow({
    where: { id: params.id },
    include: { clips: { orderBy: { position: "asc" } }, _count: { select: { clips: true } } },
  });
  return {
    project: await projectDTO(project),
    clips: await Promise.all(project.clips.map(clipDTO)),
    jobs: await activeJobs(project.id),
  };
});

/** PATCH /api/projects/:id — rename. */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  await ownedProject(user.id, params.id);
  const body = await json(req, z.object({ title: z.string().trim().min(1).max(200) }));
  const p = await db.project.update({ where: { id: params.id }, data: { title: body.title } });
  return { project: await projectDTO(p) };
});

/** DELETE /api/projects/:id — delete project, clips, exports, and all stored media. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const p = await ownedProject(user.id, params.id);
  if (p.uploadId && p.sourceKey) await abortUpload(p.sourceKey, p.uploadId);
  await db.job.updateMany({ where: { projectId: p.id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED" } });
  await db.project.delete({ where: { id: p.id } });
  // Storage cleanup is best-effort; the worker's janitor catches stragglers.
  await deletePrefix(`users/${user.id}/projects/${p.id}/`).catch((err) => log.warn("prefix delete failed", { err: String(err) }));
  return { ok: true };
});
