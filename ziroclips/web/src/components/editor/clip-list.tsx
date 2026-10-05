"use client";
import { Reorder } from "framer-motion";
import { GitMerge, GripVertical, Trash2 } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import type { ClipDTO } from "@/lib/types";
import { ScoreRing } from "@/components/app/score-ring";

export function ClipList({
  clips,
  selectedId,
  onSelect,
  onReorder,
  onReorderEnd,
  onMergeNext,
  onDelete,
}: {
  clips: ClipDTO[];
  selectedId: string;
  onSelect: (id: string) => void;
  onReorder: (clips: ClipDTO[]) => void;
  onReorderEnd: () => void;
  onMergeNext: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Reorder.Group axis="y" values={clips} onReorder={onReorder} className="space-y-2">
      {clips.map((c, i) => (
        <Reorder.Item key={c.id} value={c} onDragEnd={onReorderEnd} className="list-none">
          <div
            onClick={() => onSelect(c.id)}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-lg border p-2 transition-colors",
              c.id === selectedId ? "border-accent/60 bg-lime-400/5" : "border-border bg-panel hover:border-zinc-600",
            )}
          >
            <GripVertical className="size-4 shrink-0 cursor-grab text-zinc-600" />
            <div className="relative h-14 w-8 shrink-0 overflow-hidden rounded bg-zinc-800">
              {c.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-xs font-medium leading-snug">{c.title}</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">{formatDuration(c.endSec - c.startSec)}</p>
            </div>
            <ScoreRing score={c.viralityScore} size={34} />
            <div className="hidden flex-col gap-1 group-hover:flex">
              {i < clips.length - 1 && (
                <button onClick={(e) => { e.stopPropagation(); onMergeNext(c.id); }} title="Merge with next clip" className="text-zinc-500 hover:text-white">
                  <GitMerge className="size-3.5" />
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); onDelete(c.id); }} title="Delete clip" className="text-zinc-500 hover:text-red-400">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}
