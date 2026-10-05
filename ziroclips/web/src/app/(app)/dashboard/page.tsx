import Link from "next/link";
import { Clapperboard, Clock, Film, Plus, Download } from "lucide-react";
import { requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { PLAN_LIMITS } from "@/lib/plans";
import { projectDTO } from "@/lib/serializers";
import { monthlyUsage } from "@/lib/usage";
import { formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/app/status-badge";
import { AutoRefresh } from "@/components/app/auto-refresh";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser();
  const [usage, rows] = await Promise.all([
    monthlyUsage(user.id),
    db.project.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { _count: { select: { clips: true } }, clips: { take: 1, orderBy: { viralityScore: "desc" }, select: { thumbnailKey: true } } },
    }),
  ]);
  const projects = await Promise.all(rows.map(projectDTO));
  const limits = PLAN_LIMITS[user.plan];
  const busy = projects.some((p) => p.status === "QUEUED" || p.status === "PROCESSING");
  const stats = [
    { label: "Minutes processed", value: usage.minutesProcessed, limit: limits.minutesPerMonth, icon: Clock },
    { label: "Videos processed", value: usage.videosProcessed, limit: limits.videosPerMonth, icon: Film },
    { label: "Clips generated", value: usage.clipsGenerated, limit: Infinity, icon: Clapperboard },
    { label: "Exports", value: usage.exports, limit: Infinity, icon: Download },
  ];

  return (
    <div className="space-y-10">
      {busy && <AutoRefresh intervalMs={4000} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-400">This month on the {limits.label} plan.</p>
        </div>
        <Button asChild><Link href="/upload"><Plus /> New video</Link></Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              {s.label} <s.icon className="size-4 text-zinc-500" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {s.value}
              {Number.isFinite(s.limit) && <span className="text-sm font-normal text-zinc-500"> / {s.limit}</span>}
            </p>
            {Number.isFinite(s.limit) && <Progress className="mt-3" value={(s.value / s.limit) * 100} />}
          </Card>
        ))}
      </div>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">Projects</h2>
        {projects.length === 0 ? (
          <Card className="grid place-items-center gap-3 border-dashed py-16 text-center">
            <Film className="size-8 text-zinc-600" />
            <p className="text-zinc-300">No videos yet.</p>
            <Button asChild><Link href="/upload">Upload your first video</Link></Button>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="group">
                <Card className="overflow-hidden transition-colors group-hover:border-zinc-600">
                  <div className="relative aspect-video bg-panel-2">
                    {p.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnailUrl} alt="" className="h-full w-full object-cover opacity-90 blur-[1px] transition group-hover:opacity-100" />
                    ) : (
                      <div className="grid h-full place-items-center"><Film className="size-7 text-zinc-700" /></div>
                    )}
                    <div className="absolute left-2 top-2"><StatusBadge status={p.status} /></div>
                    {p.durationSec != null && (
                      <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums">{formatDuration(p.durationSec)}</span>
                    )}
                  </div>
                  <div className="space-y-2 p-3">
                    <p className="line-clamp-1 text-sm font-medium">{p.title}</p>
                    {p.status === "PROCESSING" || p.status === "QUEUED" ? (
                      <div className="space-y-1">
                        <Progress value={p.progress} />
                        <p className="text-xs text-zinc-500">{p.stage ?? "Queued"}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500">
                        {p.clipCount} clips · {new Date(p.createdAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
