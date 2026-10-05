/** API response shapes (client-safe). */
import type { CaptionStyle, Overlay, Word } from "./captions";
import type { CropKey } from "./crop";

export interface ProjectDTO {
  id: string;
  title: string;
  sourceType: "UPLOAD" | "YOUTUBE";
  sourceUrl: string | null;
  status: "UPLOADING" | "QUEUED" | "PROCESSING" | "READY" | "FAILED";
  progress: number;
  stage: string | null;
  error: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  clipCount: number;
  thumbnailUrl: string | null;
  proxyUrl: string | null;
}

export interface ScoreBreakdown {
  hook: number;
  emotion: number;
  pacing: number;
  completeness: number;
  engagement: number;
  signals?: Record<string, number | string | boolean>;
}

export interface ClipDTO {
  id: string;
  projectId: string;
  position: number;
  title: string;
  hook: string | null;
  reasoning: string | null;
  hashtags: string[];
  startSec: number;
  endSec: number;
  viralityScore: number;
  scoreBreakdown: ScoreBreakdown;
  words: Word[];
  cropTrack: CropKey[];
  captionStyle: CaptionStyle;
  overlays: Overlay[];
  aspectRatio: string;
  thumbnailUrl: string | null;
}

export interface ExportDTO {
  id: string;
  clipId: string;
  resolution: string;
  status: "QUEUED" | "RENDERING" | "DONE" | "FAILED";
  error: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
  createdAt: string;
}

export interface JobDTO {
  id: string;
  type: string;
  status: string;
  progress: number;
  stage: string | null;
  clipId: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
