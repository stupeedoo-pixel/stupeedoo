import { route, json, clientIp } from "@/lib/api";
import { createAccount, registerSchema } from "@/lib/accounts";
import { rateLimit } from "@/lib/ratelimit";

/** POST /api/auth/register — create an email/password account (JSON API; the UI uses a server action). */
export const POST = route(async (req) => {
  await rateLimit(`register:${clientIp(req)}`, 10, 15 * 60);
  await createAccount(await json(req, registerSchema));
  return { ok: true };
});
