/**
 * Tiny structured logger (JSON lines in prod, readable in dev). Swap for pino
 * or ship to Axiom/Datadog/Sentry later without touching call sites.
 */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = (process.env.LOG_LEVEL as Level) || "info";

function emit(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (order[level] < order[min]) return;
  const record = { t: new Date().toISOString(), level, msg, ...ctx };
  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
      : `[${level}] ${msg}${ctx ? " " + JSON.stringify(ctx, (_k, v) => (typeof v === "bigint" ? Number(v) : v)) : ""}`;
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const log = {
  debug: (m: string, c?: Record<string, unknown>) => emit("debug", m, c),
  info: (m: string, c?: Record<string, unknown>) => emit("info", m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit("warn", m, c),
  error: (m: string, c?: Record<string, unknown>) => emit("error", m, c),
};
