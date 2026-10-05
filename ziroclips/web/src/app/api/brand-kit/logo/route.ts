import { route, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";
import { keys, putObject, signedReadUrlOrNull, deleteObject } from "@/lib/storage";

const TYPES: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

/** POST /api/brand-kit/logo (multipart form, field "file") — PNG with transparency works best. */
export const POST = route(async (req) => {
  const user = await requireUser();
  await rateLimit(`logo:${user.id}`, 20, 3600);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach a logo file.");
  const ext = TYPES[file.type];
  if (!ext) throw badRequest("Logo must be PNG, JPG or WebP.");
  if (file.size > 5 * 1024 * 1024) throw badRequest("Logo must be under 5 MB.");

  const key = keys.logo(user.id, ext);
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  const prev = await db.brandKit.findUnique({ where: { userId: user.id } });
  await db.brandKit.upsert({ where: { userId: user.id }, update: { logoKey: key }, create: { userId: user.id, logoKey: key } });
  if (prev?.logoKey) await deleteObject(prev.logoKey).catch(() => {});
  return { logoUrl: await signedReadUrlOrNull(key) };
});
