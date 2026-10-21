/**
 * Schema push with automatic pre-push backup and rollback on failure.
 *
 *   npm run db:push  →  backup  →  prisma db push  →  (on failure) restore
 *
 * Replaces a bare `npx prisma db push` so a bad migration never silently
 * destroys the current database.
 */
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "child_process";

function dbPathFromEnv(): string {
  const url = process.env.DATABASE_URL || "";
  let p = url.replace(/^file:/, "");
  if (p.startsWith("./")) p = resolve(p.slice(2));
  else if (!/^[a-zA-Z]:[\\/]/.test(p) && !p.startsWith("/")) p = resolve(p);
  return p;
}

async function main() {
  const dbPath = dbPathFromEnv();
  const hasDb = existsSync(dbPath);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve("prisma/backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, `prepush-${ts}.db`);

  // SQLite needs the file closed for a consistent copy; VACUUM INTO would be
  // ideal but requires a live connection. App must not be running during
  // migration — a plain copy of an idle file is acceptable here, and a
  // missing/no-backup state aborts the push.
  if (hasDb) {
    copyFileSync(dbPath, backupPath);
    console.log(`✓ pre-push backup: ${backupPath}`);
  } else {
    console.log("· no existing database (fresh install) — nothing to back up");
  }

  const push = spawnSync("npx prisma db push", {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  if (push.status !== 0) {
    if (hasDb) {
      const failedPath = `${dbPath}.failed-${ts}`;
      try {
        renameSync(dbPath, failedPath);
        copyFileSync(backupPath, dbPath);
        console.error(`✗ prisma db push failed — restored from ${backupPath}`);
        console.error(`  broken database kept at: ${failedPath}`);
      } catch (e) {
        console.error(`✗ push failed AND restore failed: ${(e as Error).message}`);
        console.error(`  manual restore: npx tsx scripts/restore-db.ts ${backupPath} --yes`);
      }
    } else {
      console.error("✗ prisma db push failed");
    }
    process.exit(push.status ?? 1);
  }
  console.log("✓ schema pushed");
  // Keep only the 5 most recent pre-push backups.
  try {
    const { readdirSync } = await import("fs");
    const backups = readdirSync(backupDir)
      .filter((f) => f.startsWith("prepush-"))
      .sort();
    while (backups.length > 5) {
      const oldest = backups.shift()!;
      rmSync(resolve(backupDir, oldest), { force: true });
    }
  } catch {
    /* pruning is best-effort */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
