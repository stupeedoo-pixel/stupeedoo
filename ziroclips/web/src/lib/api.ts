import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import type { User } from "@prisma/client";
import { auth } from "./auth";
import { db } from "./db";
import { AppError, badRequest, forbidden, unauthorized } from "./errors";
import { log } from "./logger";

type Ctx<P> = { params: Promise<P> };

/**
 * Wraps a route handler with consistent JSON error handling + logging.
 * Known AppErrors pass their message to the client; everything else is a 500
 * with a request id you can grep for in logs.
 */
export function route<P = Record<string, string>>(
  handler: (req: NextRequest, ctx: { params: P }) => Promise<Response | unknown>,
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    const started = Date.now();
    try {
      const params = (await ctx?.params) ?? ({} as P);
      const res = await handler(req, { params });
      if (res instanceof Response) return res;
      return NextResponse.json(res ?? { ok: true }, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof AppError) {
        return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: { code: "validation", message: err.issues[0]?.message ?? "Invalid input", details: err.issues } },
          { status: 400 },
        );
      }
      const requestId = crypto.randomUUID().slice(0, 8);
      log.error("unhandled route error", {
        requestId,
        path: req.nextUrl.pathname,
        method: req.method,
        ms: Date.now() - started,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      });
      return NextResponse.json(
        { error: { code: "internal", message: `Something went wrong on our side (ref ${requestId}).` } },
        { status: 500 },
      );
    }
  };
}

export async function json<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be JSON.");
  }
  return schema.parse(body);
}

export async function currentUser(): Promise<User | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return db.user.findUnique({ where: { id } });
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw unauthorized();
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw forbidden();
  return user;
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
