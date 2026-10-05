import "server-only";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { promoteIfFirstUser } from "./auth";
import { conflict, forbidden } from "./errors";

export const registerSchema = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().email("Enter a valid email").max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

/** Shared by the /api/auth/register route and the register server action. */
export async function createAccount(input: z.infer<typeof registerSchema>) {
  const userCount = await db.user.count();
  // The first account can always be created (that's you in personal mode).
  if (!env().ALLOW_REGISTRATION && userCount > 0) throw forbidden("Registration is closed on this instance.");
  const email = input.email.toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw conflict("An account with this email already exists.");
  const user = await db.user.create({
    data: { email, name: input.name || null, passwordHash: await bcrypt.hash(input.password, 11) },
  });
  await promoteIfFirstUser(user.id);
  return user;
}
