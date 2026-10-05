import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { route, json, requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { clipDTO, ownedClip } from "@/lib/serializers";
import type { Word } from "@/lib/captions";
import { ASPECT_RATIOS } from "@/lib/captions";

type P = { id: string };

const word = z.object({ w: z.string().max(60), s: z.number().min(0), e: z.number().min(0) });
const hex = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const captionStyle = z
  .object({
    template: z.string().max(40),
    enabled: z.boolean().optional(),
    fontFamily: z.string().max(60).optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
    fontSizePct: z.number().min(0.015).max(0.12).optional(),
    textColor: hex.optional(),
    highlightColor: hex.optional(),
    strokeColor: hex.optional(),
    strokePct: z.number().min(0).max(0.02).optional(),
    shadow: z.boolean().optional(),
    uppercase: z.boolean().optional(),
    positionYPct: z.number().min(0.05).max(0.95).optional(),
    animation: z.enum(["none", "highlight", "pop"]).optional(),
    wordsPerLine: z.number().int().min(1).max(8).optional(),
    emoji: z.boolean().optional(),
    background: hex.nullable().optional(),
  })
  .strict();
const overlay = z.object({
  id: z.string().max(40),
  type: z.enum(["text", "emoji", "broll"]),
  text: z.string().max(200),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  start: z.number().min(0),
  end: z.number().min(0),
  sizePct: z.number().min(0.01).max(0.5),
  color: hex,
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  startSec: z.number().min(0).optional(),
  endSec: z.number().min(0).optional(),
  words: z.array(word).max(5000).optional(),
  captionStyle: captionStyle.optional(),
  overlays: z.array(overlay).max(50).optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
});

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  return { clip: await clipDTO(await ownedClip(user.id, params.id)) };
});

/**
 * PATCH /api/clips/:id — editor autosave. Trimming re-slices caption words from
 * the transcript for newly exposed ranges while keeping the user's word edits.
 */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const clip = await ownedClip(user.id, params.id);
  const body = await json(req, patchSchema);
  const data: Prisma.ClipUpdateInput = {};

  if (body.title) data.title = body.title;
  if (body.captionStyle) data.captionStyle = body.captionStyle;
  if (body.overlays) data.overlays = body.overlays;
  if (body.aspectRatio) data.aspectRatio = body.aspectRatio;
  let words = (body.words ?? (clip.words as unknown as Word[])).slice();

  if (body.startSec !== undefined || body.endSec !== undefined) {
    const start = body.startSec ?? clip.startSec;
    const end = body.endSec ?? clip.endSec;
    const max = clip.project.durationSec ?? Infinity;
    if (end - start < 1) throw badRequest("Clips must be at least 1 second long.");
    if (end - start > 180) throw badRequest("Clips can be at most 3 minutes long.");
    if (end > max + 0.5) throw badRequest("Clip end is past the end of the video.");
    const transcript = await db.transcript.findUnique({ where: { projectId: clip.projectId }, select: { words: true } });
    const all = (transcript?.words as unknown as Word[]) ?? [];
    const fresh = all.filter((w) => w.s >= start && w.e <= end && (w.e <= clip.startSec || w.s >= clip.endSec));
    words = [...words.filter((w) => w.s >= start && w.e <= end), ...fresh].sort((a, b) => a.s - b.s);
    data.startSec = start;
    data.endSec = end;
    // ROADMAP: enqueue a re-track job when the trim extends past the crop track.
  }
  if (body.words || data.startSec !== undefined) data.words = words as unknown as Prisma.InputJsonValue;

  const updated = await db.clip.update({ where: { id: clip.id }, data });
  return { clip: await clipDTO(updated) };
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const clip = await ownedClip(user.id, params.id);
  await db.clip.delete({ where: { id: clip.id } });
  return { ok: true };
});
