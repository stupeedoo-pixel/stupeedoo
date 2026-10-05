import * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  default: "bg-zinc-800 text-zinc-300 border-zinc-700",
  accent: "bg-lime-400/10 text-lime-300 border-lime-400/30",
  warn: "bg-amber-400/10 text-amber-300 border-amber-400/30",
  danger: "bg-red-500/10 text-red-300 border-red-500/30",
  info: "bg-sky-400/10 text-sky-300 border-sky-400/30",
};

export function Badge({ tone = "default", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)} {...props} />;
}
