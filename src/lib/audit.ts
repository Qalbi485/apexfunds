import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { logger } from "./logger";

export type AuditEntry = {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome: "SUCCESS" | "FAILURE";
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
};

const SENSITIVE_KEYS = [
  "password",
  "passwordhash",
  "token",
  "secret",
  "totpsecret",
  "txhash",
  "session",
  "cookie",
  "authorization",
  "documentnumber",
  "walletaddress",
  "privatekey",
  "otp",
  "code",
];

/**
 * Deep-sanitizes values destined for the audit log: drops passwords, tokens,
 * secrets, KYC document numbers, wallet addresses, and long opaque strings.
 */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeForAudit(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Writes an audit record. Pass the transaction client (`tx`) when called
 * inside a business transaction so the audit row commits or rolls back
 * atomically with the action itself.
 */
export async function writeAudit(
  client: Prisma.TransactionClient | typeof db,
  entry: AuditEntry
): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        outcome: entry.outcome,
        beforeJson: entry.before !== undefined ? JSON.stringify(sanitizeForAudit(entry.before)) : null,
        afterJson: entry.after !== undefined ? JSON.stringify(sanitizeForAudit(entry.after)) : null,
        metaJson: entry.meta ? JSON.stringify(sanitizeForAudit(entry.meta)) : null,
      },
    });
  } catch (e) {
    // Audit failure inside a business transaction must abort the business
    // action (callers wrap both in the same tx and this throw propagates).
    // Outside a transaction (best-effort FAILURE records) log loudly.
    logger.error("audit_write_failed", {
      action: entry.action,
      entityType: entry.entityType,
      error: (e as Error).message,
    });
    throw e;
  }
}

/**
 * Best-effort audit write for FAILURE records that must not themselves throw
 * (e.g. recording a rejected login after the business path already failed).
 */
export async function writeAuditSafe(entry: AuditEntry): Promise<void> {
  try {
    await writeAudit(db, entry);
  } catch {
    /* already logged */
  }
}
