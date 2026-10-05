import { cn } from "@/lib/utils";

/** Circular 0-100 Virality Score indicator. */
export function ScoreRing({ score, size = 44, className }: { score: number; size?: number; className?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? "#a3e635" : score >= 70 ? "#34d399" : score >= 55 ? "#fbbf24" : "#a1a1aa";
  return (
    <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }} title={`Virality Score ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#27272a" strokeWidth={4} fill="rgba(0,0,0,.55)" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={4} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} strokeLinecap="round" />
      </svg>
      <span className="absolute text-xs font-bold tabular-nums" style={{ color }}>{score}</span>
    </div>
  );
}
