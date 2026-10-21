/**
 * Next.js instrumentation hook — runs once at server boot.
 * Emits operational warnings for unsafe production configurations. Never
 * prints secret values.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Start the live market feed (Yahoo-anchored prices) for the whole server.
  try {
    const { startFeed } = await import("./lib/feed");
    startFeed();
  } catch {
    // Feed is best-effort; the app falls back to the synthetic engine.
  }

  if (process.env.NODE_ENV !== "production") return;

  const { logger } = await import("./lib/logger");

  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 32) {
    logger.warn("prod_insecure_session_secret", {
      hint: "SESSION_SECRET must be a random 32+ char value; current value is weak or missing",
    });
  }
  if (
    secret === "change_this_session_secret_32chars" ||
    secret === "dev_secret"
  ) {
    logger.warn("prod_placeholder_session_secret", {
      hint: "SESSION_SECRET is still a placeholder — rotate it before launch",
    });
  }
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 24) {
    logger.warn("prod_weak_cron_secret", {
      hint: "CRON_SECRET missing or shorter than 24 chars",
    });
  }

  try {
    const { db } = await import("./lib/db");
    const demoUsers = await db.user.count({
      where: {
        email: {
          in: [
            "demo@apexfunds.com",
            "admin@apexfunds.com",
            "trader1@example.com",
            "trader2@example.com",
          ],
        },
      },
    });
    if (demoUsers > 0) {
      logger.warn("prod_demo_accounts_present", {
        count: demoUsers,
        hint: "Demo/demo-seeded accounts exist in the production database — disable or delete them before launch",
      });
    }
  } catch (e) {
    logger.warn("prod_safety_check_failed", { error: (e as Error).message });
  }
}
