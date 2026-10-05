"use client";
import { useSyncExternalStore } from "react";

/**
 * Tiny external store for the playhead (source seconds). Only components that
 * subscribe (preview captions, timeline playhead) re-render each frame — the
 * rest of the editor doesn't.
 */
export interface Clock {
  get: () => number;
  set: (t: number) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createClock(initial = 0): Clock {
  let t = initial;
  const subs = new Set<() => void>();
  return {
    get: () => t,
    set: (v) => {
      if (v === t) return;
      t = v;
      subs.forEach((f) => f());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useClock(clock: Clock): number {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}
