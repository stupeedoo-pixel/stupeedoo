import type { NextRequest } from "next/server";
import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { verifyToken, writeLocalPart } from "@/lib/storage";

// Large streaming bodies; never cache.
export const dynamic = "force-dynamic";

/**
 * PUT /api/uploads/:projectId/parts/:n?exp&sig — LOCAL driver chunk sink.
 * Authorized by the HMAC signature (same model as an S3 presigned URL), so it
 * works without cookies and can be retried per chunk.
 */
export const PUT = route<{ projectId: string; n: string }>(async (req: NextRequest, { params }) => {
  if (env().STORAGE_DRIVER !== "local") throw notFound();
  const n = Number(params.n);
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  const p = await db.project.findUnique({ where: { id: params.projectId } });
  if (!p || !p.uploadId || !p.sourceKey) throw notFound("Upload");
  if (!verifyToken("upload", `${p.id}:${p.uploadId}:${n}`, exp, sig)) throw forbidden("Upload link expired — please retry.");
  if (p.status !== "UPLOADING") throw conflict("Upload already completed.");
  const plan = (p.settings as { upload?: { partSize: number; partCount: number } }).upload;
  if (!plan || !req.body || n < 1 || n > plan.partCount) throw badRequest("Invalid part.");

  const total = Number(p.fileSize);
  const offset = (n - 1) * plan.partSize;
  const expected = Math.min(plan.partSize, total - offset);
  const { etag, bytes } = await writeLocalPart(p.sourceKey, offset, req.body);
  if (bytes !== expected) throw badRequest(`Chunk ${n} was ${bytes} bytes, expected ${expected}. Retrying usually fixes this.`);
  return new Response(null, { status: 200, headers: { ETag: etag, "Access-Control-Expose-Headers": "ETag" } });
});
