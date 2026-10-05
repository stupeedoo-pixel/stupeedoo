import "server-only";
import { z } from "zod";

/**
 * Typed, validated server environment. Everything is env-driven so the same
 * code runs as a cheap single-user box (local disk, no Redis) or as a SaaS
 * (R2/S3, Redis rate limits, Google OAuth).
 */
const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars (openssl rand -base64 32)"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // --- Auth
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  /** First user becomes ADMIN on UNLIMITED plan; handy for personal mode. */
  SINGLE_USER_MODE: bool(true),
  /** Set false once you've created your account to lock down sign-ups. */
  ALLOW_REGISTRATION: bool(true),

  // --- Storage
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("../storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().optional(), // e.g. https://<account>.r2.cloudflarestorage.com
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(false),
  SIGNED_URL_TTL_SEC: z.coerce.number().int().positive().default(3600),

  // --- Limits
  MAX_UPLOAD_BYTES: z.coerce.number().default(10 * 1024 ** 3),
  MAX_VIDEO_MINUTES: z.coerce.number().default(240),
  UPLOAD_PART_BYTES: z.coerce.number().default(32 * 1024 * 1024),

  // --- Optional infra
  REDIS_URL: z.string().optional(),
  ENABLE_YOUTUBE: bool(true),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
