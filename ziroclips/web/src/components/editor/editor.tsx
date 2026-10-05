"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Captions, Check, Download, LayoutTemplate, Loader2, Shapes } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client";
import type { ClipDTO, JobDTO } from "@/lib/types";
import { ClipList } from "./clip-list";
import { createClock } from "./clock";
import { CaptionsPanel, ElementsPanel, ExportPanel, FormatPanel } from "./panels";
import { Preview } from "./preview";
import { Timeline } from "./timeline";
import type { BrandPreview, ClipPatch, SourceInfo } from "./types";

type SaveState = "saved" | "saving" | "dirty" | "error";

export function Editor({
  projectId,
  projectTitle,
  initialClips,
  source,
  brand,
  allow4k,
}: {
  projectId: string;
  projectTitle: string;
  initialClips: ClipDTO[];
  source: SourceInfo;
  brand: BrandPreview;
  allow4k: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [clips, setClips] = useState(initialClips);
  const [selectedId, setSelectedId] = useState(params.get("clip") ?? initialClips[0]?.id);
  const [save, setSave] = useState<SaveState>("saved");
  const [regenerating, setRegenerating] = useState(false);
  const clock = useMemo(() => createClock(), []);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pending = useRef<{ id: string; patch: ClipPatch } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clip = clips.find((c) => c.id === selectedId) ?? clips[0];

  // ---------------------------------------------------------------- autosave
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setSave("saving");
    try {
      const { clip: saved } = await api<{ clip: ClipDTO }>(`/api/clips/${p.id}`, { method: "PATCH", json: p.patch });
      // Trims re-slice words server-side; adopt them unless newer edits are queued.
      setClips((cs) => cs.map((c) => (c.id === saved.id ? (pending.current?.id === saved.id ? { ...saved, ...pending.current.patch } : saved) : c)));
      setSave(pending.current ? "dirty" : "saved");
    } catch (e) {
      setSave("error");
      toast.error(`Couldn't save: ${(e as Error).message}`);
    }
  }, []);

  const change = useCallback(
    (patch: ClipPatch) => {
      if (!clip) return;
      if (pending.current && pending.current.id !== clip.id) void flush();
      pending.current = { id: clip.id, patch: { ...(pending.current?.id === clip.id ? pending.current.patch : {}), ...patch } };
      setClips((cs) => cs.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)));
      setSave("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), patch.startSec !== undefined || patch.endSec !== undefined ? 150 : 700);
    },
    [clip, flush],
  );

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [flush]);

  const select = async (id: string) => {
    await flush();
    setSelectedId(id);
    router.replace(`/projects/${projectId}/edit?clip=${id}`, { scroll: false });
  };

  // ---------------------------------------------------------------- structural ops
  const reloadClips = async () => {
    const r = await api<{ clips: ClipDTO[] }>(`/api/projects/${projectId}/clips`);
    setClips(r.clips);
    return r.clips;
  };

  const split = async (at: number) => {
    await flush();
    try {
      const r = await api<{ clip: ClipDTO }>(`/api/clips/${clip.id}/split`, { method: "POST", json: { at } });
      await reloadClips();
      toast.success("Clip split in two");
      void select(r.clip.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const mergeNext = async (id: string) => {
    await flush();
    try {
      await api(`/api/clips/${id}/merge-next`, { method: "POST" });
      await reloadClips();
      toast.success("Clips merged");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this clip?")) return;
    await flush();
    await api(`/api/clips/${id}`, { method: "DELETE" });
    const rest = await reloadClips();
    if (id === selectedId && rest[0]) void select(rest[0].id);
  };

  const persistOrder = async () => {
    try {
      await api(`/api/projects/${projectId}/clips/reorder`, { method: "POST", json: { ids: clips.map((c) => c.id) } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const regenerate = async () => {
    if (!confirm("Re-transcribe this clip? Manual word edits for this clip will be replaced.")) return;
    await flush();
    try {
      setRegenerating(true);
      await api(`/api/clips/${clip.id}/regenerate-captions`, { method: "POST" });
    } catch (e) {
      setRegenerating(false);
      toast.error((e as Error).message);
    }
  };

  // Poll the regenerate job; refresh the clip when it finishes.
  useEffect(() => {
    if (!regenerating) return;
    const id = setInterval(async () => {
      const s = await api<{ jobs: JobDTO[] }>(`/api/projects/${projectId}/status`);
      if (!s.jobs.some((j) => j.type === "REGENERATE_CAPTIONS")) {
        setRegenerating(false);
        const r = await api<{ clip: ClipDTO }>(`/api/clips/${clip.id}`);
        setClips((cs) => cs.map((c) => (c.id === r.clip.id ? r.clip : c)));
        toast.success("Captions regenerated");
      }
    }, 2000);
    return () => clearInterval(id);
  }, [regenerating, projectId, clip?.id]);

  // ---------------------------------------------------------------- shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const v = videoRef.current;
      if (e.code === "Space" && v) {
        e.preventDefault();
        if (v.paused) void v.play();
        else v.pause();
      } else if (e.key === "s" && !e.metaKey && !e.ctrlKey) {
        void split(clock.get());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!clip) {
    return (
      <div className="grid place-items-center gap-4 py-24 text-center">
        <p className="text-zinc-400">No clips in this project.</p>
        <Button asChild><Link href={`/projects/${projectId}`}>Back to project</Link></Button>
      </div>
    );
  }

  return (
    <div className="-mx-4 sm:-mx-6">
      <div className="mb-4 flex items-center gap-3 px-4 sm:px-6">
        <Button variant="ghost" size="icon" asChild><Link href={`/projects/${projectId}`} aria-label="Back"><ArrowLeft /></Link></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-zinc-500">{projectTitle}</p>
          <p className="truncate font-semibold">{clip.title}</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          {save === "saving" ? <Loader2 className="size-3 animate-spin" /> : save === "saved" ? <Check className="size-3 text-accent" /> : null}
          {save === "saved" ? "Saved" : save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved" : "Save failed"}
        </span>
      </div>

      <div className="grid gap-4 px-4 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)_360px]">
        <aside className="scrollbar-thin order-3 max-h-[calc(100dvh-8rem)] overflow-y-auto lg:order-1">
          <ClipList
            clips={clips}
            selectedId={clip.id}
            onSelect={select}
            onReorder={setClips}
            onReorderEnd={persistOrder}
            onMergeNext={mergeNext}
            onDelete={remove}
          />
        </aside>

        <section className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
          <div className="h-[min(68dvh,720px)] min-h-[360px]">
            <Preview clip={clip} source={source} brand={brand} clock={clock} videoRef={videoRef} onChange={change} />
          </div>
          <Timeline clip={clip} duration={source.duration} clock={clock} videoRef={videoRef} onTrim={(s, e) => change({ startSec: s, endSec: e })} onSplit={split} />
          <p className="hidden text-center text-[11px] text-zinc-600 lg:block">Space play/pause · S split at playhead · drag captions & overlays in the preview</p>
        </section>

        <aside className="order-2 lg:order-3">
          <div className="rounded-xl border border-border bg-panel p-4">
            <Tabs defaultValue="captions">
              <TabsList className="w-full">
                <TabsTrigger value="captions"><Captions /> Captions</TabsTrigger>
                <TabsTrigger value="elements"><Shapes /> Elements</TabsTrigger>
                <TabsTrigger value="format"><LayoutTemplate /> Clip</TabsTrigger>
                <TabsTrigger value="export"><Download /> Export</TabsTrigger>
              </TabsList>
              <div className="scrollbar-thin max-h-[calc(100dvh-14rem)] overflow-y-auto pr-1">
                <TabsContent value="captions"><CaptionsPanel clip={clip} onChange={change} regenerating={regenerating} onRegenerate={regenerate} /></TabsContent>
                <TabsContent value="elements"><ElementsPanel clip={clip} onChange={change} /></TabsContent>
                <TabsContent value="format"><FormatPanel clip={clip} onChange={change} /></TabsContent>
                <TabsContent value="export"><ExportPanel clip={clip} allow4k={allow4k} flush={flush} /></TabsContent>
              </div>
            </Tabs>
          </div>
        </aside>
      </div>
    </div>
  );
}
