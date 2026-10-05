import { z } from "zod";
import { route, json, requireUser } from "@/lib/api";
import { conflict } from "@/lib/errors";
import { ownedProject } from "@/lib/serializers";
import { partUploadUrls } from "@/lib/storage";

/** POST /api/projects/:id/upload/parts — signed URLs for a batch of chunk uploads. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const p = await ownedProject(user.id, params.id);
  if (p.status !== "UPLOADING" || !p.uploadId || !p.sourceKey) throw conflict("This project is not accepting uploads.");
  const plan = (p.settings as { upload?: { partCount: number } }).upload;
  const body = await json(req, z.object({ partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100) }));
  if (plan && body.partNumbers.some((n) => n > plan.partCount)) throw conflict("Part number out of range.");
  return { urls: await partUploadUrls(p.id, p.sourceKey, p.uploadId, body.partNumbers) };
});
