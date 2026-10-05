import { route, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { activeJobs } from "@/lib/jobs";
import { ownedProject } from "@/lib/serializers";

/**
 * GET /api/projects/:id/status — cheap polling endpoint (every ~2s while busy).
 * `clipsVersion` changes whenever clips are added/updated so the client knows
 * when to refetch the full clip list.
 * ROADMAP: replace polling with SSE fed by Postgres LISTEN/NOTIFY.
 */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const p = await ownedProject(user.id, params.id);
  const agg = await db.clip.aggregate({ where: { projectId: p.id }, _count: true, _max: { updatedAt: true } });
  return {
    status: p.status,
    progress: p.progress,
    stage: p.stage,
    error: p.error,
    clipsVersion: `${agg._count}:${agg._max.updatedAt?.getTime() ?? 0}`,
    jobs: await activeJobs(p.id),
  };
});
