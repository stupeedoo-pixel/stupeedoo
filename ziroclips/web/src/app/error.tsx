"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center text-center">
      <div className="space-y-4">
        <p className="text-lg font-semibold">Something went wrong</p>
        <p className="text-sm text-zinc-400">{error.digest ? `Reference: ${error.digest}` : "Please try again."}</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
