import type { ClipDTO } from "@/lib/types";

export type ClipPatch = Partial<Pick<ClipDTO, "title" | "startSec" | "endSec" | "words" | "captionStyle" | "overlays" | "aspectRatio">>;

export interface BrandPreview {
  logoUrl: string | null;
  logoPosition: string;
  logoScalePct: number;
}

export interface SourceInfo {
  proxyUrl: string | null;
  width: number;
  height: number;
  duration: number;
}
