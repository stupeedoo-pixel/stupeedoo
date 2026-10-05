import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { signedReadUrlOrNull } from "@/lib/storage";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const schema = z.object({
  logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
  logoScalePct: z.number().min(0.05).max(0.4).optional(),
  primaryColor: hex.optional(),
  secondaryColor: hex.optional(),
  fontFamily: z.string().max(60).optional(),
  captionStyle: z.record(z.unknown()).nullable().optional(),
  removeLogo: z.boolean().optional(),
});

async function dto(userId: string) {
  const kit = await db.brandKit.upsert({ where: { userId }, update: {}, create: { userId } });
  return { ...kit, logoUrl: await signedReadUrlOrNull(kit.logoKey) };
}

/** GET /api/brand-kit */
export const GET = route(async () => {
  const user = await requireUser();
  return { brandKit: await dto(user.id) };
});

/** PUT /api/brand-kit — update colours/fonts/logo placement/default caption style. */
export const PUT = route(async (req) => {
  const user = await requireUser();
  const { removeLogo, captionStyle, ...rest } = await json(req, schema);
  await db.brandKit.upsert({
    where: { userId: user.id },
    update: { ...rest, ...(removeLogo ? { logoKey: null } : {}), ...(captionStyle !== undefined ? { captionStyle: (captionStyle ?? undefined) as Prisma.InputJsonValue | undefined } : {}) },
    create: { userId: user.id, ...rest },
  });
  return { brandKit: await dto(user.id) };
});
