import "server-only";
import type { Clip, Export, Project } from "@prisma/client";
import { db } from "./db";
import { notFound } from "./errors";
import { signedReadUrl, signedReadUrlOrNull } from "./storage";
import type { ClipDTO, ExportDTO, ProjectDTO } from "./types";
import type { CaptionStyle, Overlay, Word } from "./captions";
import type { CropKey } from "./crop";

export async function projectDTO(p: Project & { _count?: { clips: number }; clips?: Pick<Clip, "thumbnailKey">[] }): Promise<ProjectDTO> {
  return {
    id: p.id,
    title: p.title,
    sourceType: p.sourceType,
    sourceUrl: p.sourceUrl,
    status: p.status,
    progress: p.progress,
    stage: p.stage,
    error: p.error,
    durationSec: p.durationSec,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt.toISOString(),
    clipCount: p._count?.clips ?? 0,
    thumbnailUrl: await signedReadUrlOrNull(p.clips?.[0]?.thumbnailKey),
    proxyUrl: await signedReadUrlOrNull(p.proxyKey),
  };
}

export async function clipDTO(c: Clip): Promise<ClipDTO> {
  return {
    id: c.id,
    projectId: c.projectId,
    position: c.position,
    title: c.title,
    hook: c.hook,
    reasoning: c.reasoning,
    hashtags: c.hashtags,
    startSec: c.startSec,
    endSec: c.endSec,
    viralityScore: c.viralityScore,
    scoreBreakdown: c.scoreBreakdown as unknown as ClipDTO["scoreBreakdown"],
    words: c.words as unknown as Word[],
    cropTrack: c.cropTrack as unknown as CropKey[],
    captionStyle: c.captionStyle as unknown as CaptionStyle,
    overlays: c.overlays as unknown as Overlay[],
    aspectRatio: c.aspectRatio,
    thumbnailUrl: await signedReadUrlOrNull(c.thumbnailKey),
  };
}

export async function exportDTO(e: Export, clipTitle?: string): Promise<ExportDTO> {
  const safe = (clipTitle ?? "clip").replace(/[^\w\- ]+/g, "").trim().slice(0, 60).replace(/\s+/g, "-") || "clip";
  return {
    id: e.id,
    clipId: e.clipId,
    resolution: e.resolution,
    status: e.status,
    error: e.error,
    sizeBytes: e.sizeBytes == null ? null : Number(e.sizeBytes),
    downloadUrl: e.status === "DONE" && e.outputKey ? await signedReadUrl(e.outputKey, { downloadName: `${safe}-${e.resolution}.mp4` }) : null,
    createdAt: e.createdAt.toISOString(),
  };
}

/** Ownership-checked loaders. 404 (not 403) so ids can't be probed. */
export async function ownedProject(userId: string, id: string) {
  const p = await db.project.findFirst({ where: { id, userId } });
  if (!p) throw notFound("Project");
  return p;
}

export async function ownedClip(userId: string, id: string) {
  const c = await db.clip.findFirst({ where: { id, project: { userId } }, include: { project: true } });
  if (!c) throw notFound("Clip");
  return c;
}
