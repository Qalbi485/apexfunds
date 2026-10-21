/**
 * Consistent SQLite backup using VACUUM INTO (safe while the app is running:
 * produces a transactionally consistent snapshot, unlike a raw file copy).
 *
 * Usage:
 *   npx tsx scripts/backup-db.ts [outputPath]
 * Default output: prisma/backups/apex-<timestamp>.db
 */
import "dotenv/config";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient();

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const out = resolve(process.argv[2] || `prisma/backups/apex-${ts}.db`);
  mkdirSync(dirname(out), { recursive: true });

  // VACUUM INTO refuses to overwrite an existing file — fail loudly instead
  // of clobbering a previous backup.
  await db.$executeRawUnsafe(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  console.log(`✓ Backup written: ${out}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("Backup failed:", (e as Error).message);
  process.exit(1);
});
