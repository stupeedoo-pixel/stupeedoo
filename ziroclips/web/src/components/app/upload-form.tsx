"use client";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, FileVideo, Link2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client";
import { TEMPLATES } from "@/lib/captions";
import { readDuration, uploadInParts } from "@/lib/upload";
import { formatBytes, formatDuration } from "@/lib/utils";
import type { ProjectDTO } from "@/lib/types";

const ACCEPT = ".mp4,.mov,.webm,.mkv,.m4v,video/mp4,video/quicktime,video/webm";
const LANGS = [
  ["auto", "Auto-detect"], ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"],
  ["it", "Italian"], ["nl", "Dutch"], ["hi", "Hindi"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["ar", "Arabic"],
];

export function UploadForm({ youtubeEnabled, maxBytes, maxMinutes }: { youtubeEnabled: boolean; maxBytes: number; maxMinutes: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ frac: number; bps: number } | null>(null);
  const [clipCount, setClipCount] = useState<number | "auto">("auto");
  const [range, setRange] = useState<[number, number]>([20, 75]);
  const [language, setLanguage] = useState("auto");
  const [template, setTemplate] = useState("bold-modern");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const settings = { ...(clipCount === "auto" ? {} : { clipCount }), minSec: range[0], maxSec: range[1], language, captionTemplate: template };

  const pick = useCallback(
    async (f: File | undefined) => {
      if (!f) return;
      if (f.size > maxBytes) return toast.error(`That file is ${formatBytes(f.size)} — the limit is ${formatBytes(maxBytes)}.`);
      setFile(f);
      const d = await readDuration(f);
      setDuration(d);
      if (d && d > maxMinutes * 60) toast.warning(`This video is ${Math.round(d / 60)} min; the limit is ${maxMinutes} min.`);
    },
    [maxBytes, maxMinutes],
  );

  async function startUpload() {
    if (!file) return;
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      const res = await api<{ project: ProjectDTO; upload: { partSize: number; partCount: number } }>("/api/projects", {
        method: "POST",
        json: {
          settings,
          source: { type: "upload", fileName: file.name, fileSize: file.size, contentType: file.type || "video/mp4", durationSec: duration ?? undefined },
        },
      });
      setProgress({ frac: 0, bps: 0 });
      await uploadInParts({
        projectId: res.project.id,
        file,
        partSize: res.upload.partSize,
        partCount: res.upload.partCount,
        signal: abortRef.current.signal,
        onProgress: (frac, bps) => setProgress({ frac, bps }),
      });
      toast.success("Upload complete — processing started.");
      router.push(`/projects/${res.project.id}`);
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast.error((err as Error).message);
      setBusy(false);
      setProgress(null);
    }
  }

  async function startYoutube() {
    setBusy(true);
    try {
      const res = await api<{ project: ProjectDTO }>("/api/projects", {
        method: "POST",
        json: { settings, source: { type: "youtube", url: url.trim(), acceptTerms: rights } },
      });
      router.push(`/projects/${res.project.id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="upload">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="upload"><UploadCloud /> Upload file</TabsTrigger>
          {youtubeEnabled && <TabsTrigger value="youtube"><Link2 /> YouTube URL</TabsTrigger>}
        </TabsList>

        <TabsContent value="upload">
          {!file ? (
            <motion.div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
              onClick={() => inputRef.current?.click()}
              animate={{ scale: dragging ? 1.01 : 1 }}
              className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed px-6 py-20 text-center transition-colors ${dragging ? "border-accent bg-lime-400/5" : "border-border bg-panel hover:border-zinc-600"}`}
            >
              <UploadCloud className="mb-3 size-10 text-zinc-500" />
              <p className="font-medium">Drop a video here or click to browse</p>
              <p className="mt-1 text-sm text-zinc-500">MP4, MOV, WebM · up to {formatBytes(maxBytes)} · up to {maxMinutes} min</p>
              <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            </motion.div>
          ) : (
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <div className="grid size-12 place-items-center rounded-lg bg-panel-2"><FileVideo className="size-6 text-accent" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-sm text-zinc-500">{formatBytes(file.size)}{duration ? ` · ${formatDuration(duration)}` : ""}</p>
                </div>
                {!busy && (
                  <Button variant="ghost" size="icon" onClick={() => { setFile(null); setDuration(null); }} aria-label="Remove file"><X /></Button>
                )}
              </div>
              {progress && (
                <div className="mt-5 space-y-2">
                  <Progress value={progress.frac * 100} />
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>{Math.round(progress.frac * 100)}% uploaded</span>
                    <span>
                      {formatBytes(progress.bps)}/s
                      {progress.bps > 0 && ` · ~${formatDuration((file.size * (1 - progress.frac)) / progress.bps)} left`}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>Cancel</Button>
                </div>
              )}
            </Card>
          )}
          <div className="mt-6 flex justify-end">
            <Button size="lg" disabled={!file} loading={busy} onClick={startUpload}>Upload & generate clips</Button>
          </div>
        </TabsContent>

        {youtubeEnabled && (
          <TabsContent value="youtube" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="yt">YouTube video URL</Label>
              <Input id="yt" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="flex gap-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200/90">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-2">
                <p>
                  Only public videos are supported. Downloading from YouTube may violate YouTube&apos;s Terms of Service unless you own the content or have
                  permission from the rights holder.
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-zinc-200">
                  <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="accent-lime-400" />
                  I own this video or have permission to repurpose it.
                </label>
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="lg" disabled={!url || !rights} loading={busy} onClick={startYoutube}>Import & generate clips</Button>
            </div>
          </TabsContent>
        )}
      </Tabs>

      <Card className="grid gap-6 p-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Clip length</Label>
          <Slider min={10} max={180} step={5} value={range} onValueChange={(v) => setRange([v[0], Math.max(v[1], v[0] + 10)] as [number, number])} />
          <p className="text-xs text-zinc-500">{range[0]}s – {range[1]}s per clip</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="count">Number of clips</Label>
          <Select id="count" value={String(clipCount)} onChange={(e) => setClipCount(e.target.value === "auto" ? "auto" : Number(e.target.value))}>
            <option value="auto">Auto (≈1 per 4 min of video)</option>
            {[3, 5, 8, 10, 12, 15, 20].map((n) => <option key={n} value={n}>{n} clips</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lang">Spoken language</Label>
          <Select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl">Caption style</Label>
          <Select id="tpl" value={template} onChange={(e) => setTemplate(e.target.value)}>
            {Object.entries(TEMPLATES).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
          </Select>
        </div>
      </Card>
    </div>
  );
}
