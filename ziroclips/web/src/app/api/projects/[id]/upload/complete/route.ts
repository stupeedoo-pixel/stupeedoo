import { z } from "zod";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { badRequest, conflict } from "@/lib/errors";
import { enqueue } from "@/lib/jobs";
import { ownedProject, projectDTO } from "@/lib/serializers";
import { completeUpload } from "@/lib/storage";

const schema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1) })).min(1).max(10_000),
});

/** POST /api/projects/:id/upload/complete — finalize the upload and queue processing. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const p = await ownedProject(user.id, params.id);
  if (p.status !== "UPLOADING" || !p.uploadId || !p.sourceKey) throw conflict("Upload already completed.");
  const body = await json(req, schema);
  const plan = (p.settings as { upload?: { partCount: number } }).upload;
  if (plan && new Set(body.parts.map((x) => x.partNumber)).size !== plan.partCount) {
    throw badRequest(`Expected ${plan.partCount} parts, got ${body.parts.length}. Please retry the upload.`);
  }
  await completeUpload(p.sourceKey, p.uploadId, body.parts);
  const project = await db.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: p.id },
      data: { status: "QUEUED", stage: "Queued", uploadId: null, progress: 0 },
    });
    await enqueue("PROCESS_PROJECT", { userId: user.id, projectId: p.id }, tx);
    return updated;
  });
  return { project: await projectDTO(project) };
});
