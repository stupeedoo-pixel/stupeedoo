"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowDownWideNarrow, Check, Download, Pencil, RotateCcw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "./status-badge";
import { ScoreRing } from "./score-ring";
import { api } from "@/lib/client";
import { formatDuration } from "@/lib/utils";
import type { ClipDTO, JobDTO, ProjectDTO } from "@/lib/types";

type Data = { project: ProjectDTO; clips: ClipDTO[]; jobs: JobDTO[] };

const STEPS = [
  { at: 0, label: "Upload" },
  { at: 13, label: "Analyze" },
  { at: 20, label: "Transcribe" },
  { at: 56, label: "Find highlights" },
  { at: 65, label: "Reframe" },
  { at: 91, label: "Finish" },
];

export function ProjectView({ initial }: { initial: Data }) {
  const router = useRouter();
  const [data, setData] = useState<Data>(initial);
  const [sort, setSort] = useState<"score" | "order">("score");
  const [editingTitle, setEditingTitle] = useState(false);
  const { project, clips, jobs } = data;
  const busy = project.status === "QUEUED" || project.status === "PROCESSING" || jobs.length > 0;

  const reload = useCallback(async () => {
    const d = await api<Data>(`/api/projects/${project.id}`);
    setData(d);
  }, [project.id]);

  // Poll while anything is running; refetch clips when the server says they changed.
  useEffect(() => {
    if (!busy) return;
    let version = "";
    const id = setInterval(async () => {
      try {
        const s = await api<{ status: ProjectDTO["status"]; progress: number; stage: string | null; error: string | null; clipsVersion: string; jobs: JobDTO[] }>(
          `/api/projects/${project.id}/status`,
        );
        setData((d) => ({ ...d, project: { ...d.project, status: s.status, progress: s.progress, stage: s.stage, error: s.error }, jobs: s.jobs }));
        if ((version && s.clipsVersion !== version) || s.status === "READY" || s.jobs.length === 0) await reload();
        version = s.clipsVersion;
      } catch {
        /* transient; keep polling */
      }
    }, 2000);
    return () => clearInterval(id);
  }, [busy, project.id, reload]);

  const sorted = [...clips].sort((a, b) => (sort === "score" ? b.viralityScore - a.viralityScore : a.position - b.position));

  async function act(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast.success(ok);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2"><StatusBadge status={project.status} />
            {project.durationSec != null && <span className="text-xs text-zinc-500">{formatDuration(project.durationSec)} source</span>}
          </div>
          {editingTitle ? (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const title = String(new FormData(e.currentTarget).get("title"));
                await act(() => api(`/api/projects/${project.id}`, { method: "PATCH", json: { title } }));
                setEditingTitle(false);
              }}
            >
              <Input name="title" defaultValue={project.title} autoFocus className="h-10 w-80 text-lg" />
              <Button size="icon" type="submit" aria-label="Save title"><Check /></Button>
            </form>
          ) : (
            <h1 className="group flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
              <span className="truncate">{project.title}</span>
              <button onClick={() => setEditingTitle(true)} className="opacity-0 transition group-hover:opacity-100" aria-label="Rename"><Pencil className="size-4 text-zinc-500" /></button>
            </h1>
          )}
        </div>
        {project.status === "READY" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => act(() => api(`/api/projects/${project.id}/find-more`, { method: "POST", json: { count: 5 } }), "Looking for more clips…")} disabled={jobs.some((j) => j.type === "FIND_MORE_CLIPS")}>
              <Sparkles /> Find more clips
            </Button>
            <Button variant="secondary" onClick={() => act(() => api(`/api/projects/${project.id}/export-all`, { method: "POST", json: { resolution: "1080p" } }), "Exporting all clips — open each clip to download.")}>
              <Download /> Export all
            </Button>
            {clips.length > 0 && (
              <Button asChild><Link href={`/projects/${project.id}/edit?clip=${sorted[0]?.id}`}><Wand2 /> Open editor</Link></Button>
            )}
          </div>
        )}
      </div>

      {(project.status === "QUEUED" || project.status === "PROCESSING" || project.status === "UPLOADING") && (
        <Card className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="font-medium">{project.stage ?? "Queued"}</p>
              <p className="text-sm text-zinc-500">A 60-minute video usually takes 5–12 minutes. You can leave this page.</p>
            </div>
            <span className="text-2xl font-semibold tabular-nums text-accent">{project.progress}%</span>
          </div>
          <Progress value={project.progress} className="h-2" />
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
            {STEPS.map((s, i) => {
              const next = STEPS[i + 1]?.at ?? 101;
              const state = project.progress >= next ? "done" : project.progress >= s.at ? "active" : "todo";
              return (
                <div key={s.label} className={state === "todo" ? "text-zinc-600" : state === "active" ? "text-white" : "text-zinc-400"}>
                  <span className={`mr-1.5 inline-block size-1.5 rounded-full ${state === "done" ? "bg-accent" : state === "active" ? "animate-pulse bg-accent" : "bg-zinc-700"}`} />
                  {s.label}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {project.status === "FAILED" && (
        <Card className="flex flex-wrap items-center gap-4 border-red-500/30 bg-red-500/5 p-5">
          <AlertCircle className="size-5 text-red-400" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-red-200">Processing failed</p>
            <p className="text-sm text-red-200/70">{project.error ?? "Unknown error"}</p>
          </div>
          <Button variant="secondary" onClick={() => act(() => api(`/api/projects/${project.id}/retry`, { method: "POST" }), "Retrying…")}><RotateCcw /> Retry</Button>
        </Card>
      )}

      {jobs.some((j) => j.type === "FIND_MORE_CLIPS") && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3 text-sm">
          <Sparkles className="size-4 animate-pulse text-accent" /> Finding more clips… {jobs.find((j) => j.type === "FIND_MORE_CLIPS")?.stage}
        </div>
      )}

      {clips.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">{clips.length} clips</h2>
            <Button variant="ghost" size="sm" onClick={() => setSort(sort === "score" ? "order" : "score")}>
              <ArrowDownWideNarrow /> {sort === "score" ? "Sorted by Virality Score" : "Sorted by your order"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <AnimatePresence>
              {sorted.map((c, i) => (
                <motion.div key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03 } }}>
                  <Link href={`/projects/${project.id}/edit?clip=${c.id}`} className="group block">
                    <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-panel-2 transition group-hover:border-zinc-500">
                      {c.thumbnailUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                      <ScoreRing score={c.viralityScore} className="absolute right-2 top-2" />
                      <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums">{formatDuration(c.endSec - c.startSec)}</span>
                      <div className="absolute inset-x-0 bottom-0 space-y-1 p-3">
                        <p className="line-clamp-2 text-sm font-semibold leading-snug">{c.title}</p>
                        {c.hook && <p className="line-clamp-2 text-xs text-zinc-400">“{c.hook}”</p>}
                      </div>
                    </div>
                  </Link>
                  {c.scoreBreakdown?.signals?.method === "heuristic" && i === 0 && (
                    <Badge tone="warn" className="mt-2">Heuristic picks — add ANTHROPIC_API_KEY for AI picks</Badge>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      <div className="flex justify-end border-t border-border pt-6">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" className="text-red-300 hover:text-red-200"><Trash2 /> Delete project</Button>
          </DialogTrigger>
          <DialogContent title="Delete this project?" description="This permanently deletes the source video, all clips and exports.">
            <div className="flex justify-end gap-2">
              <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
              <Button
                variant="destructive"
                onClick={async () => {
                  try {
                    await api(`/api/projects/${project.id}`, { method: "DELETE" });
                    router.push("/dashboard");
                    router.refresh();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
