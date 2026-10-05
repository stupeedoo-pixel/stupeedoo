"""Plan limits — mirror of web/src/lib/plans.ts (minutes are enforced here after ffprobe)."""
import math

PLAN_LIMITS = {
    "FREE": {"minutes_per_month": 60, "max_video_minutes": 60},
    "PRO": {"minutes_per_month": 600, "max_video_minutes": 240},
    "UNLIMITED": {"minutes_per_month": math.inf, "max_video_minutes": 240},
}
