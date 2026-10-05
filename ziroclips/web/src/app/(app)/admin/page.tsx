import { redirect } from "next/navigation";
import { currentUser } from "@/lib/api";
import { db } from "@/lib/db";
import { monthStart } from "@/lib/usage";
import { Card } from "@/components/ui/card";
import { AdminUsers } from "@/components/app/admin-users";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const user = await currentUser();
  if (user?.role !== "ADMIN") redirect("/dashboard");
  const since = monthStart();
  const [users, usage, jobs, projects] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "desc" }, take: 500, select: { id: true, email: true, name: true, role: true, plan: true, createdAt: true, _count: { select: { projects: true } } } }),
    db.usageEvent.groupBy({ by: ["userId", "kind"], where: { createdAt: { gte: since } }, _sum: { amount: true } }),
    db.job.groupBy({ by: ["status"], _count: true, where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
    db.project.count(),
  ]);
  const minutes = usage.filter((u) => u.kind === "MINUTES_PROCESSED").reduce((a, u) => a + (u._sum.amount ?? 0), 0);
  const rows = users.map((u) => {
    const get = (k: string) => usage.find((r) => r.userId === u.id && r.kind === k)?._sum.amount ?? 0;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      plan: u.plan,
      createdAt: u.createdAt.toISOString(),
      projects: u._count.projects,
      minutes: Math.round(get("MINUTES_PROCESSED")),
      clips: get("CLIPS_GENERATED"),
      exports: get("EXPORTS"),
    };
  });
  const stat = (label: string, value: string | number) => (
    <Card className="p-4">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">Admin</h1>
      <div className="grid gap-3 sm:grid-cols-4">
        {stat("Users", users.length)}
        {stat("Projects", projects)}
        {stat("Minutes this month", Math.round(minutes))}
        {stat("Jobs (24h)", jobs.map((j) => `${j._count} ${j.status.toLowerCase()}`).join(" · ") || "0")}
      </div>
      <AdminUsers users={rows} currentUserId={user.id} />
    </div>
  );
}
