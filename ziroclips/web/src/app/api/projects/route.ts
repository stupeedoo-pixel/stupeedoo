import path from "node:path";
import { z } from "zod";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { badRequest } from "@/lib/errors";
import { enqueue } from "@/lib/jobs";
import { rateLimit } from "@/lib/ratelimit";
import { projectDTO } from "@/lib/serializers";
import { keys, startUpload } from "@/lib/storage";
import { assertCanProcess } from "@/lib/usage";

const ALLOWED_EXT = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];
const YOUTUBE_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]{6,}/i;

const settingsSchema = z
  .object({
    clipCount: z.number().int().min(1).max(30).optional(),
    minSec: z.number().min(10).max(120).optional(),
    maxSec: z.number().min(15).max(180).optional(),
    language: z.string().max(10).optional(), // ISO code or "auto"
    captionTemplate: z.string().max(40).optional(),
  })
  .default({});

const createSchema = z.object({
  title: z.string().trim().max(200).optional(),
  settings: settingsSchema,
  source: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("upload"),
      fileName: z.string().min(1).max(300),
      fileSize: z.number().int().positive(),
      contentType: z.string().max(100).default("video/mp4"),
      durationSec: z.number().positive().optional(),
    }),
    z.object({
      type: z.literal("youtube"),
      url: z.string().url().regex(YOUTUBE_RE, "That doesn't look like a YouTube video URL."),
      acceptTerms: z.literal(true, { errorMap: () => ({ message: "Please confirm you have the rights to use this video." }) }),
    }),
  ]),
});

/** GET /api/projects — the user's project history (newest first). */
export const GET = route(async () => {
  const user = await requireUser();
  const projects = await db.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { clips: true } }, clips: { take: 1, orderBy: { viralityScore: "desc" }, select: { thumbnailKey: true } } },
    take: 100,
  });
  return { projects: await Promise.all(projects.map(projectDTO)) };
});

/**
 * POST /api/projects — create a project from an upload or a YouTube URL.
 * Uploads return a chunked-upload plan; the client then calls
 * /upload/parts and /upload/complete. YouTube projects are queued immediately.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  await rateLimit(`create-project:${user.id}`, 20, 3600);
  const body = await json(req, createSchema);
  const e = env();

  if (body.source.type === "youtube") {
    if (!e.ENABLE_YOUTUBE) throw badRequest("YouTube import is disabled on this instance.");
    await assertCanProcess(user, null);
    const url = body.source.url;
    const project = await db.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          userId: user.id,
          title: body.title || "YouTube import",
          sourceType: "YOUTUBE",
          sourceUrl: url,
          status: "QUEUED",
          stage: "Queued",
          settings: body.settings,
        },
      });
      await enqueue("PROCESS_PROJECT", { userId: user.id, projectId: p.id }, tx);
      return p;
    });
    return { project: await projectDTO(project) };
  }

  const src = body.source;
  const ext = path.extname(src.fileName).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw badRequest(`Unsupported file type. Use ${ALLOWED_EXT.join(", ")}.`);
  if (src.fileSize > e.MAX_UPLOAD_BYTES) throw badRequest(`File is too large (max ${(e.MAX_UPLOAD_BYTES / 1024 ** 3).toFixed(0)} GB).`);
  if (src.durationSec && src.durationSec > e.MAX_VIDEO_MINUTES * 60) {
    throw badRequest(`Videos can be at most ${e.MAX_VIDEO_MINUTES} minutes long.`);
  }
  await assertCanProcess(user, src.durationSec ? src.durationSec / 60 : null);

  const project = await db.project.create({
    data: {
      userId: user.id,
      title: body.title || path.basename(src.fileName, ext).slice(0, 200),
      sourceType: "UPLOAD",
      status: "UPLOADING",
      stage: "Uploading",
      fileSize: BigInt(src.fileSize),
      durationSec: src.durationSec,
      settings: body.settings,
    },
  });
  const key = keys.source(user.id, project.id, ext);
  const plan = await startUpload(key, src.fileSize, src.contentType);
  await db.project.update({
    where: { id: project.id },
    data: { sourceKey: key, uploadId: plan.uploadId, settings: { ...body.settings, upload: { partSize: plan.partSize, partCount: plan.partCount } } },
  });
  return { project: await projectDTO(project), upload: { partSize: plan.partSize, partCount: plan.partCount } };
});
