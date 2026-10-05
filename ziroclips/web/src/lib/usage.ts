import "server-only";
import type { User } from "@prisma/client";
import { db } from "./db";
import { PLAN_LIMITS } from "./plans";
import { limitReached } from "./errors";

export function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function monthlyUsage(userId: string) {
  const rows = await db.usageEvent.groupBy({
    by: ["kind"],
    where: { userId, createdAt: { gte: monthStart() } },
    _sum: { amount: true },
  });
  const get = (k: string) => rows.find((r) => r.kind === k)?._sum.amount ?? 0;
  return {
    minutesProcessed: Math.round(get("MINUTES_PROCESSED") * 10) / 10,
    videosProcessed: get("VIDEOS_PROCESSED"),
    clipsGenerated: get("CLIPS_GENERATED"),
    exports: get("EXPORTS"),
  };
}

/**
 * Soft pre-check before enqueueing processing. `estimatedMinutes` comes from
 * the browser (<video> metadata) or yt-dlp; the worker re-checks the real
 * duration after ffprobe, so a lying client can't bypass it.
 */
export async function assertCanProcess(user: User, estimatedMinutes: number | null) {
  const limits = PLAN_LIMITS[user.plan];
  const usage = await monthlyUsage(user.id);
  if (usage.videosProcessed >= limits.videosPerMonth) {
    throw limitReached(`You've used all ${limits.videosPerMonth} videos on the ${limits.label} plan this month.`);
  }
  if (estimatedMinutes != null) {
    if (estimatedMinutes > limits.maxVideoMinutes) {
      throw limitReached(`Videos on the ${limits.label} plan can be up to ${limits.maxVideoMinutes} minutes.`);
    }
    if (usage.minutesProcessed + estimatedMinutes > limits.minutesPerMonth) {
      const left = Math.max(0, Math.floor(limits.minutesPerMonth - usage.minutesProcessed));
      throw limitReached(`This video needs ~${Math.ceil(estimatedMinutes)} min but you have ${left} min left this month.`);
    }
  }
}
