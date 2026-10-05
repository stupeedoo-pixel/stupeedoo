import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center text-center">
      <div className="space-y-4">
        <p className="font-display text-6xl font-black text-accent">404</p>
        <p className="text-zinc-400">That page doesn&apos;t exist (or isn&apos;t yours).</p>
        <Button asChild><Link href="/dashboard">Go to dashboard</Link></Button>
      </div>
    </div>
  );
}
