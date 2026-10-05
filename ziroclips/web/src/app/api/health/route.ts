import { db } from "@/lib/db";

/** GET /api/health — liveness + DB + queue depth (for uptime monitors). */
export async function GET() {
  try {
    const [queued, running, stale] = await Promise.all([
      db.job.count({ where: { status: "QUEUED" } }),
      db.job.count({ where: { status: "RUNNING" } }),
      db.job.count({ where: { status: "RUNNING", heartbeatAt: { lt: new Date(Date.now() - 5 * 60_000) } } }),
    ]);
    return Response.json({ ok: true, db: "up", queue: { queued, running, stale } });
  } catch (err) {
    return Response.json({ ok: false, db: "down", error: String(err) }, { status: 503 });
  }
}
