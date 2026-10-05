import { route, requireUser } from "@/lib/api";
import { PLAN_LIMITS } from "@/lib/plans";
import { monthlyUsage } from "@/lib/usage";

/** GET /api/usage — this month's usage vs plan limits. */
export const GET = route(async () => {
  const user = await requireUser();
  const limits = PLAN_LIMITS[user.plan];
  const fin = (n: number) => (Number.isFinite(n) ? n : null); // JSON has no Infinity
  return {
    plan: user.plan,
    usage: await monthlyUsage(user.id),
    limits: { ...limits, minutesPerMonth: fin(limits.minutesPerMonth), videosPerMonth: fin(limits.videosPerMonth) },
  };
});
