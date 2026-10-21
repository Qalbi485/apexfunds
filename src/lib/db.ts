import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * Transaction budgets for financial operations. SQLite serializes writers, so
 * a burst of concurrent transactions queues up — without an explicit budget
 * Prisma's 5s default turns that queue into P1008 timeouts (user-facing 500s)
 * even though the work itself takes milliseconds.
 */
export const TX_OPTS = { maxWait: 15_000, timeout: 30_000 } as const;
