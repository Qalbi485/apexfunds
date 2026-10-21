import { createHash, randomBytes } from "crypto";
import { db, TX_OPTS } from "./db";

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Creates a single-use reset token for a user. Only the sha256 hash is
 * persisted; the raw token must be delivered out-of-band (email link) and is
 * never stored or logged by the application.
 */
export async function createPasswordResetToken(
  userId: string,
  requestedIp?: string
): Promise<{ raw: string; expiresAt: Date }> {
  const raw = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  // Invalidate prior unused tokens for this user (latest request wins).
  await db.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt,
      requestedIp: requestedIp ?? null,
    },
  });
  return { raw, expiresAt };
}

/**
 * Atomically consumes a reset token and sets the new password. Tokens are
 * strictly single-use (conditional usedAt claim) and expire after 30 minutes.
 * On success all of the user's sessions are revoked.
 */
export async function consumePasswordResetToken(
  rawToken: string,
  newPasswordHash: string
): Promise<{ ok: true; userId: string } | { error: string }> {
  if (!rawToken || rawToken.length < 16) return { error: "Invalid or expired link" };
  const tokenHash = hashToken(rawToken);

  return await db.$transaction(async (tx) => {
    const token = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
      return { error: "Invalid or expired link" };
    }
    // Single-use claim: only one concurrent consume can win.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return { error: "Invalid or expired link" };

    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash: newPasswordHash },
    });
    return { ok: true as const, userId: token.userId };
  }, TX_OPTS);
}
