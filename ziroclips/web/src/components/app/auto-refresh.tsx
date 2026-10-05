"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-runs the server component on an interval (cheap polling for list pages). */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
