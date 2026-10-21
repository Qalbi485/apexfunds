/**
 * PHASE D recovery drill — runs ONLY against staging DB paths.
 *
 * Exercises the documented recovery tooling end to end:
 *   1. consistent backup (VACUUM INTO) while the staging server is running
 *   2. backup integrity + row-count verification
 *   3. restore refusal without --yes (negative test)
 *   4. restore into an isolated DB + post-restore verification
 *   5. migration rollback drill: baseline push -> add junk column ->
 *      push refuses (data loss) -> safe-db-push auto-restores the DB
 *   6. dev.db untouched (mtime + size) throughout
 *
 * Never touches prisma/dev.db writes, never runs against production.
 */
import "dotenv/config";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { resolve } from "path";
import { spawnSync } from "child_process";
import { PrismaClient } from "../src/generated/prisma/client";

const DEV_DB = resolve("prisma/dev.db");
const MIGR_DB = resolve(".staging/migr.db");
const RESTORED_DB = resolve(".staging/restored.db");
const TABLES = [
  "user",
  "challenge",
  "trade",
  "payment",
  "payout",
  "auditLog",
  "setting",
] as const;

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function run(cmd: string, env: Record<string, string> = {}) {
  const r = spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim(),
  };
}

async function counts(dbPath: string) {
  const c = new PrismaClient({ datasourceUrl: `file:${dbPath}` });
  try {
    const out: Record<string, number> = {};
    for (const t of TABLES) {
      const rows = (await c.$queryRawUnsafe(
        `SELECT COUNT(*) AS n FROM "${t}"`
      )) as Array<{ n: bigint | number }>;
      out[t] = Number(rows[0]?.n ?? 0);
    }
    return out;
  } finally {
    await c.$disconnect();
  }
}

async function integrity(dbPath: string) {
  const c = new PrismaClient({ datasourceUrl: `file:${dbPath}` });
  try {
    const rows = (await c.$queryRawUnsafe(
      "PRAGMA integrity_check"
    )) as Array<{ integrity_check: string }>;
    return rows[0]?.integrity_check ?? "unknown";
  } finally {
    await c.$disconnect();
  }
}

async function hasColumn(dbPath: string, col: string) {
  const c = new PrismaClient({ datasourceUrl: `file:${dbPath}` });
  try {
    const rows = (await c.$queryRawUnsafe(
      'PRAGMA table_info("User")'
    )) as Array<{ name: string }>;
    return rows.some((r) => r.name === col);
  } finally {
    await c.$disconnect();
  }
}

function sameCounts(
  a: Record<string, number>,
  b: Record<string, number>
): string {
  const diffs = TABLES.filter((t) => a[t] !== b[t]).map(
    (t) => `${t}: ${a[t]} vs ${b[t]}`
  );
  return diffs.join(", ");
}

async function main() {
  console.log("\n=== PHASE D RECOVERY DRILL ===\n");

  const dbUrl = process.env.DATABASE_URL ?? "";
  check(
    "precondition: DATABASE_URL points at .staging/staging.db",
    dbUrl.includes(".staging/staging.db"),
    `got: ${dbUrl.slice(0, 40)}...`
  );

  const devBefore = statSync(DEV_DB);

  // 1. Consistent backup while server running.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(`prisma/backups/apex-drill-${ts}.db`);
  const liveBefore = await counts(resolve(".staging/staging.db"));
  const b = run(`npx tsx scripts/backup-db.ts "${backupPath}"`);
  check("backup: VACUUM INTO succeeds while server running", b.status === 0, b.out.slice(-300));
  check("backup: file exists with size > 0", existsSync(backupPath) && statSync(backupPath).size > 0);

  // 2. Integrity + counts.
  const backupCounts = await counts(backupPath);
  check(
    "backup: row counts match live DB taken at backup time",
    sameCounts(liveBefore, backupCounts) === "",
    sameCounts(liveBefore, backupCounts)
  );
  check("backup: PRAGMA integrity_check = ok", (await integrity(backupPath)) === "ok");

  // 3. Restore refusal without --yes (negative test).
  if (existsSync(RESTORED_DB)) rmSync(RESTORED_DB, { force: true });
  const noYes = run(
    `npx tsx scripts/restore-db.ts "${backupPath}" --target "${RESTORED_DB}"`
  );
  check(
    "restore: refuses to run without --yes",
    noYes.status !== 0 && !existsSync(RESTORED_DB),
    `status=${noYes.status}`
  );

  // 4. Restore into isolated DB.
  const r = run(
    `npx tsx scripts/restore-db.ts "${backupPath}" --yes --target "${RESTORED_DB}"`
  );
  check("restore: succeeds into isolated DB", r.status === 0, r.out.slice(-300));
  if (existsSync(RESTORED_DB)) {
    const restoredCounts = await counts(RESTORED_DB);
    check(
      "restore: row counts identical to backup",
      sameCounts(backupCounts, restoredCounts) === "",
      sameCounts(backupCounts, restoredCounts)
    );
    check("restore: PRAGMA integrity_check = ok", (await integrity(RESTORED_DB)) === "ok");
  } else {
    check("restore: restored DB file exists", false, "missing");
  }

  // 5. Migration / rollback drill on isolated migr.db.
  if (existsSync(MIGR_DB)) rmSync(MIGR_DB, { force: true });
  const migrUrl = `file:${MIGR_DB}`;
  const makeMigr = run(`npx tsx scripts/backup-db.ts "${MIGR_DB}"`);
  check("migr: baseline copy created", makeMigr.status === 0, makeMigr.out.slice(-200));
  const baseline = await counts(MIGR_DB);

  const push1 = run("npx prisma db push --skip-generate", {
    DATABASE_URL: migrUrl,
  });
  check("migr: baseline prisma db push succeeds", push1.status === 0, push1.out.slice(-300));

  const c0 = new PrismaClient({ datasourceUrl: migrUrl });
  await c0.$executeRawUnsafe(
    'ALTER TABLE "User" ADD COLUMN junk_phase_drill TEXT'
  );
  // prisma db push only refuses data-loss when the column holds data —
  // an empty extra column is silently dropped (exit 0). Seed it so the
  // refusal path is genuinely exercised.
  await c0.$executeRawUnsafe(
    `UPDATE "User" SET junk_phase_drill = 'PRECIOUS_DRILL_DATA' ` +
      `WHERE id = (SELECT id FROM "User" LIMIT 1)`
  );
  await c0.$disconnect();
  check("migr: junk column added with data", await hasColumn(MIGR_DB, "junk_phase_drill"));

  const push2 = run("npx prisma db push --skip-generate", {
    DATABASE_URL: migrUrl,
  });
  check(
    "migr: push with data-loss refuses (non-zero, junk column kept)",
    push2.status !== 0 && (await hasColumn(MIGR_DB, "junk_phase_drill")),
    `status=${push2.status} out=${push2.out.slice(-200)}`
  );

  const safe = run("npx tsx scripts/safe-db-push.ts", {
    DATABASE_URL: migrUrl,
  });
  check("migr: safe-db-push fails on data-loss (non-zero)", safe.status !== 0, `status=${safe.status}`);
  check(
    "migr: safe-db-push restored pre-push state (junk data preserved, not lost)",
    (await hasColumn(MIGR_DB, "junk_phase_drill"))
  );
  const afterSafe = await counts(MIGR_DB);
  check(
    "migr: row counts equal baseline after auto-restore",
    sameCounts(baseline, afterSafe) === "",
    sameCounts(baseline, afterSafe)
  );
  check("migr: restored DB integrity = ok", (await integrity(MIGR_DB)) === "ok");
  const failedCopy = readdirSync(".staging").some((f) =>
    f.startsWith("migr.db.failed-")
  );
  check("migr: broken DB kept aside (migr.db.failed-*)", failedCopy);
  const prepush = readdirSync(resolve("prisma/backups")).some((f) =>
    f.startsWith("prepush-")
  );
  check("migr: pre-push backup written to prisma/backups/", prepush);

  // 5b. Corruption + recovery: corrupt page-2's b-tree header byte (SQLite
  // header magic left intact) AND truncate to a non-page-multiple size —
  // both must be caught by integrity_check / open. Then restore.
  const raw = readFileSync(MIGR_DB);
  const pageSize = 4096;
  if (raw.length > pageSize + 16) raw[pageSize + 8] = 0xff;
  writeFileSync(MIGR_DB, raw.subarray(0, raw.length - 100));
  let corruptDetected = false;
  try {
    corruptDetected = (await integrity(MIGR_DB)) !== "ok";
  } catch {
    corruptDetected = true;
  }
  check("corruption: detected by integrity_check/open", corruptDetected);

  const rec = run(
    `npx tsx scripts/restore-db.ts "${backupPath}" --yes --target "${MIGR_DB}"`
  );
  check("corruption: restore-db repairs from backup", rec.status === 0, rec.out.slice(-300));
  check("corruption: repaired DB integrity = ok", (await integrity(MIGR_DB)) === "ok");
  const repairedCounts = await counts(MIGR_DB);
  check(
    "corruption: repaired row counts match backup",
    sameCounts(backupCounts, repairedCounts) === "",
    sameCounts(backupCounts, repairedCounts)
  );

  // 6. dev.db untouched.
  const devAfter = statSync(DEV_DB);
  check(
    "dev.db untouched (mtime + size identical)",
    devBefore.mtimeMs === devAfter.mtimeMs && devBefore.size === devAfter.size,
    `before=${devBefore.size}/${devBefore.mtimeMs} after=${devAfter.size}/${devAfter.mtimeMs}`
  );

  console.log(`\n=== DRILL RESULT: ${passed} passed, ${failures.length} failed ===`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(`backup: ${backupPath}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error("DRILL ERROR:", (e as Error).stack ?? e);
  process.exit(1);
});
