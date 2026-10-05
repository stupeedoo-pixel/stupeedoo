import { route, requireAdmin } from "@/lib/api";
import { db } from "@/lib/db";
import { monthStart } from "@/lib/usage";

/** GET /api/admin/users — users with this month's usage (admin only). */
export const GET = route(async () => {
  await requireAdmin();
  const [users, usage] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, email: true, name: true, role: true, plan: true, createdAt: true, _count: { select: { projects: true } } },
    }),
    db.usageEvent.groupBy({ by: ["userId", "kind"], where: { createdAt: { gte: monthStart() } }, _sum: { amount: true } }),
  ]);
  return {
    users: users.map((u) => {
      const mine = usage.filter((r) => r.userId === u.id);
      const get = (k: string) => mine.find((r) => r.kind === k)?._sum.amount ?? 0;
      return {
        ...u,
        projects: u._count.projects,
        minutesThisMonth: Math.round(get("MINUTES_PROCESSED")),
        clipsThisMonth: get("CLIPS_GENERATED"),
        exportsThisMonth: get("EXPORTS"),
      };
    }),
  };
});
