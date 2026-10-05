import "server-only";
import type { JobType, Prisma } from "@prisma/client";
import { db } from "./db";
import { log } from "./logger";

/**
 * Producer side of the Postgres job queue. The Python worker claims jobs with
 * `FOR UPDATE SKIP LOCKED` (worker/ziro_worker/db.py).
 *
 * ROADMAP: emit NOTIFY on insert so the worker wakes instantly instead of polling.
 */
export async function enqueue(
  type: JobType,
  data: { userId: string; projectId?: string; clipId?: string; payload?: Prisma.InputJsonValue; priority?: number },
  tx: Prisma.TransactionClient = db,
) {
  const job = await tx.job.create({
    data: {
      type,
      userId: data.userId,
      projectId: data.projectId,
      clipId: data.clipId,
      payload: data.payload ?? {},
      priority: data.priority ?? 0,
      maxAttempts: type === "EXPORT_CLIP" ? 3 : 2,
    },
  });
  log.info("job enqueued", { jobId: job.id, type, projectId: data.projectId, clipId: data.clipId });
  return job;
}

export async function activeJobs(projectId: string) {
  return db.job.findMany({
    where: { projectId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, status: true, progress: true, stage: true, clipId: true, createdAt: true },
  });
}
