import { z } from "zod";
import { route, json, requireAdmin } from "@/lib/api";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/errors";

/** PATCH /api/admin/users/:id { plan?, role? } */
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const body = await json(req, z.object({ plan: z.enum(["FREE", "PRO", "UNLIMITED"]).optional(), role: z.enum(["USER", "ADMIN"]).optional() }));
  if (params.id === admin.id && body.role === "USER") throw badRequest("You can't demote yourself.");
  const user = await db.user.update({ where: { id: params.id }, data: body, select: { id: true, plan: true, role: true } });
  return { user };
});
