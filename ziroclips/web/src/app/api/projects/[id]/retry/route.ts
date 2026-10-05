import { route, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { conflict } from "@/lib/errors";
import { enqueue } from "@/lib/jobs";
import { ownedProject, projectDTO } from "@/lib/serializers";

/** POST /api/projects/:id/retry — re-run processing for a FAILED project. */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const p = await ownedProject(user.id, params.id);
  if (p.status !== "FAILED") throw conflict("Only failed projects can be retried.");
  if (p.sourceType === "UPLOAD" && !p.sourceKey) throw conflict("The upload never finished — please create a new project.");
  const project = await db.$transaction(async (tx) => {
    const updated = await tx.project.update({ where: { id: p.id }, data: { status: "QUEUED", stage: "Queued", error: null, progress: 0 } });
    await enqueue("PROCESS_PROJECT", { userId: user.id, projectId: p.id }, tx);
    return updated;
  });
  return { project: await projectDTO(project) };
});
