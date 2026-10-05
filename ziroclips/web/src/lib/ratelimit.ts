import "server-only";
import Redis from "ioredis";
import { env } from "./env";
import { tooMany } from "./errors";

/**
 * Fixed-window rate limiter. Uses Redis when REDIS_URL is set (required once
 * you run >1 web instance), otherwise an in-process Map (fine for one box).
 */
let redis: Redis | null | undefined;
function client(): Redis | null {
  if (redis === undefined) {
    const url = env().REDIS_URL;
    redis = url ? new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false }) : null;
  }
  return redis;
}

const memory = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  const bucketKey = `rl:${key}:${windowStart}`;
  const retryAfter = windowStart + windowSec - now;

  const r = client();
  if (r) {
    const count = await r.incr(bucketKey);
    if (count === 1) await r.expire(bucketKey, windowSec + 5);
    if (count > limit) throw tooMany(retryAfter);
    return;
  }

  const entry = memory.get(bucketKey);
  if (!entry) {
    memory.set(bucketKey, { count: 1, resetAt: windowStart + windowSec });
    if (memory.size > 10_000) for (const [k, v] of memory) if (v.resetAt < now) memory.delete(k);
    return;
  }
  entry.count++;
  if (entry.count > limit) throw tooMany(retryAfter);
}
