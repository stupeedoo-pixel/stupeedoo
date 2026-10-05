import { z } from "zod";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { conflict } from "@/lib/errors";
import { enqueue } from "@/lib/jobs";
import { rateLimit } from "@/lib/ratelimit";
import { ownedProject } from "@/lib/serializers";

/** POST /api/projects/:id/find-more { count? } — ask the AI for additional clips (excluding existing ranges). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await rateLimit(`find-more:${user.id}`, 10, 3600);
  const p = await ownedProject(user.id, params.id);
  if (p.status !== "READY") throw conflict("Wait for processing to finish first.");
  const { count } = await json(req, z.object({ count: z.number().int().min(1).max(15).default(5) }));
  const busy = await db.job.findFirst({ where: { projectId: p.id, type: "FIND_MORE_CLIPS", status: { in: ["QUEUED", "RUNNING"] } } });
  if (busy) throw conflict("Already looking for more clips…");
  const job = await enqueue("FIND_MORE_CLIPS", { userId: user.id, projectId: p.id, payload: { count } });
  return { jobId: job.id };
});
