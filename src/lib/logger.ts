/**
 * Structured JSON logging. Safe: never logs secrets — callers must pass
 * already-sanitized metadata. Written to stderr/stdout so container/log
 * collectors can ingest it.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minLevel(): number {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LEVEL_ORDER[raw] ?? LEVEL_ORDER.info;
}

export function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < minLevel()) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta || {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
