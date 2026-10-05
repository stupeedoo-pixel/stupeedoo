import type { Plan } from "@prisma/client";

/**
 * Plan limits (per calendar month, UTC). Mirrored in worker/ziro_worker/plans.py
 * because the worker enforces minutes after probing the real duration.
 *
 * ROADMAP (monetization): wire PRO to Stripe Checkout + metered overage using
 * the append-only usage_events ledger.
 */
export interface PlanLimits {
  label: string;
  minutesPerMonth: number;
  videosPerMonth: number;
  maxVideoMinutes: number;
  exportResolutions: ("1080p" | "4k")[];
  watermark: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { label: "Free", minutesPerMonth: 60, videosPerMonth: 2, maxVideoMinutes: 60, exportResolutions: ["1080p"], watermark: false },
  PRO: { label: "Pro", minutesPerMonth: 600, videosPerMonth: 50, maxVideoMinutes: 240, exportResolutions: ["1080p", "4k"], watermark: false },
  UNLIMITED: { label: "Unlimited", minutesPerMonth: Infinity, videosPerMonth: Infinity, maxVideoMinutes: 240, exportResolutions: ["1080p", "4k"], watermark: false },
};
