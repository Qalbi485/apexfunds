/**
 * Restore a SQLite database from a backup produced by scripts/backup-db.ts.
 *
 * SAFETY:
 *   - the backup is verified first (PRAGMA integrity_check + row counts),
 *   - the current database is copied aside to <target>.pre-restore before
 *     being overwritten,
 *   - refuses to run without --yes.
 *
 * IMPORTANT: stop the app (pm2 stop all) before restoring the live database.
 *
 * Usage:
 *   npx tsx scripts/restore-db.ts <backupPath> [--yes] [--target <dbPath>]
 */
import "dotenv/config";
import { copyFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";
import { PrismaClient } from "../src/generated/prisma/client";

function targetFromEnv(): string {
  const url = process.env.DATABASE_URL || "";
  let p = url.replace(/^file:/, "");
  if (p.startsWith("./")) p = resolve(p.slice(2));
  else if (!/^[a-zA-Z]:[\\/]/.test(p) && !p.startsWith("/")) p = resolve(p);
  return p;
}

async function inspect(
  path: string
): Promise<{ users: number; integrity: string }> {
  const conn = new PrismaClient({ datasourceUrl: `file:${path}` });
  try {
    const rows = (await conn.$queryRawUnsafe(
      "PRAGMA integrity_check"
    )) as Array<{ integrity_check: string }>;
    const integrity = rows[0]?.integrity_check ?? "unknown";
    const users = await conn.user.count();
    return { users, integrity };
  } finally {
    await conn.$disconnect();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes");
  const targetFlag = args.indexOf("--target");
  const target =
    targetFlag >= 0 && args[targetFlag + 1]
      ? resolve(args[targetFlag + 1])
      : targetFromEnv();
  const backup = args.find((a) => !a.startsWith("--") && a !== args[targetFlag + 1]);

  if (!backup) {
    console.error(
      "Usage: npx tsx scripts/restore-db.ts <backupPath> [--yes] [--target <dbPath>]"
    );
    process.exit(1);
  }
  const backupPath = resolve(backup);
  if (!existsSync(backupPath)) {
    console.error(`Backup not found: ${backupPath}`);
    process.exit(1);
  }
  if (!confirmed) {
    console.error(
      "Refusing to overwrite without --yes.\n" +
        `  target : ${target}\n` +
        `  backup : ${backupPath}\n` +
        "  Stop the app first (pm2 stop all), then re-run with --yes."
    );
    process.exit(1);
  }

  console.log(`Verifying backup ${backupPath} (${statSync(backupPath).size} bytes)...`);
  const pre = await inspect(backupPath);
  if (pre.integrity !== "ok") {
    console.error(`Backup failed integrity_check: ${pre.integrity}`);
    process.exit(1);
  }
  console.log(`✓ backup valid (users=${pre.users})`);

  if (existsSync(target)) {
    const safety = `${target}.pre-restore`;
    copyFileSync(target, safety);
    console.log(`✓ current database copied to ${safety}`);
  }

  copyFileSync(backupPath, target);
  const post = await inspect(target);
  if (post.integrity !== "ok" || post.users !== pre.users) {
    console.error("Post-restore verification FAILED", post);
    process.exit(1);
  }
  console.log(`✓ restored → ${target} (users=${post.users}, integrity=ok)`);
}

main().catch((e) => {
  console.error("Restore failed:", (e as Error).message);
  process.exit(1);
});
