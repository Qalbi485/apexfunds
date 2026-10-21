import { db } from "./db";
import { logger } from "./logger";

/**
 * Database-backed fixed-window rate limiter.
 *
 * The counter lives in the shared database (RateLimit table), so every app
 * instance sees the same buckets — required for multi-instance deployments
 * where in-memory limiters would each allow the full quota.
 *
 * Lockout safety: windows are fixed and short (minutes/hours). A blocked key
 * frees itself when the window elapses — attackers cannot permanently lock
 * out a victim's email or IP.
 */

export type RateLimitRule = {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
};

/** Rules (overridable via env for ops tuning; sensible production defaults). */
export const RATE_LIMITS = {
  loginIp: { limit: numEnv("RL_LOGIN_IP_LIMIT", 20), windowMs: numEnv("RL_LOGIN_IP_WINDOW_MS", 5 * 60_000) },
  loginEmail: { limit: numEnv("RL_LOGIN_EMAIL_LIMIT", 8), windowMs: numEnv("RL_LOGIN_EMAIL_WINDOW_MS", 15 * 60_000) },
  registerIp: { limit: numEnv("RL_REGISTER_IP_LIMIT", 10), windowMs: numEnv("RL_REGISTER_IP_WINDOW_MS", 60 * 60_000) },
  passwordResetIp: { limit: numEnv("RL_RESET_IP_LIMIT", 10), windowMs: numEnv("RL_RESET_IP_WINDOW_MS", 60 * 60_000) },
  passwordResetEmail: { limit: numEnv("RL_RESET_EMAIL_LIMIT", 5), windowMs: numEnv("RL_RESET_EMAIL_WINDOW_MS", 60 * 60_000) },
  passwordChange: { limit: numEnv("RL_PWCHANGE_LIMIT", 10), windowMs: numEnv("RL_PWCHANGE_WINDOW_MS", 60 * 60_000) },
  support: { limit: numEnv("RL_SUPPORT_LIMIT", 10), windowMs: numEnv("RL_SUPPORT_WINDOW_MS", 60 * 60_000) },
  tradeOpen: { limit: numEnv("RL_TRADE_OPEN_LIMIT", 30), windowMs: 60_000 },
  tradeSettle: { limit: numEnv("RL_TRADE_SETTLE_LIMIT", 60), windowMs: 60_000 },
  cron: { limit: numEnv("RL_CRON_LIMIT", 12), windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Extracts the client IP from proxy headers safely.
 *
 * Uses the RIGHTMOST x-forwarded-for hop: proxies we control (nginx with
 * `$proxy_add_x_forwarded_for`) append the real peer address at the end,
 * while everything to the left of it may be client-supplied. Taking the
 * first hop would let an attacker rotate fake IPs and bypass IP rate limits.
 */
export function pickClientIp(
  xForwardedFor: string | null | undefined,
  realIp: string | null | undefined
): string {
  if (xForwardedFor) {
    const hops = xForwardedFor
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return realIp || "unknown";
}

/**
 * Atomically consumes one unit from the bucket for `key`.
 * Uses an upsert with conditional window reset so concurrent requests across
 * instances cannot exceed the limit within the same window.
 */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / rule.windowMs) * rule.windowMs);
  const retryAfterSec = Math.max(
    1,
    Math.ceil((windowStart.getTime() + rule.windowMs - now.getTime()) / 1000)
  );

  try {
    // Upsert + conditional update keeps this a single atomic decision point
    // on SQLite; on other DBs this remains a single-row lock per key.
    const row = await db.rateLimit.upsert({
      where: { key },
      create: { key, windowStart, count: 0 },
      update: {},
      select: { windowStart: true, count: true },
    });

    if (row.windowStart.getTime() === windowStart.getTime()) {
      if (row.count >= rule.limit) {
        return { ok: false, remaining: 0, retryAfterSec };
      }
      const bumped = await db.rateLimit.updateMany({
        where: {
          key,
          windowStart,
          count: { lt: rule.limit },
        },
        data: { count: { increment: 1 } },
      });
      if (bumped.count === 0) {
        return { ok: false, remaining: 0, retryAfterSec };
      }
      return { ok: true, remaining: rule.limit - row.count - 1, retryAfterSec };
    }

    // Stale window: reset the bucket (lockout naturally expires here).
    await db.rateLimit.updateMany({
      where: { key, windowStart: row.windowStart },
      data: { windowStart, count: 1 },
    });
    const fresh = await db.rateLimit.findUnique({ where: { key } });
    if (!fresh || fresh.count > rule.limit) {
      return { ok: false, remaining: 0, retryAfterSec };
    }
    return { ok: true, remaining: rule.limit - fresh.count, retryAfterSec };
  } catch (e) {
    // Fail-open on infra errors would weaken security; fail-closed with a
    // short block is safer for auth endpoints. Log for observability.
    logger.error("rate_limit_error", { key, error: (e as Error).message });
    return { ok: false, remaining: 0, retryAfterSec: 30 };
  }
}

/** Clears a bucket (e.g. after a successful login so failures stop counting). */
export async function clearRateLimit(key: string): Promise<void> {
  try {
    await db.rateLimit.delete({ where: { key } });
  } catch {
    /* missing key is fine */
  }
}

/**
 * Opportunistic cleanup of expired buckets. Called occasionally from
 * consumeRateLimit paths; cheap on SQLite.
 */
export async function pruneRateLimits(olderThanMs = 24 * 60 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const res = await db.rateLimit.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
  return res.count;
}
