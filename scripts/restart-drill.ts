/**
 * PHASE D restart-recovery drill (staging only).
 *
 * 1. register + login a drill user, prove /dashboard reachable (200)
 * 2. hard-kill the staging server (Stop-Process on port 3100)
 * 3. restart it detached (same staging env, log appended)
 * 4. prove the SAME DB-backed session cookie still works after restart
 * 5. run the full security-smoke battery against the restarted server
 * 6. clean up the drill user
 */
import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { PrismaClient } from "../src/generated/prisma/client";

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3100";
/* eslint-disable @typescript-eslint/no-require-imports */
const { encodeReply } = require(
  "next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.node.production.js"
) as { encodeReply: (v: unknown) => Promise<string | FormData> };

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

function actionMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const path = ".next/server/server-reference-manifest.json";
  if (existsSync(path)) {
    const j = JSON.parse(readFileSync(path, "utf8")) as {
      node?: Record<string, { exportedName?: string }>;
    };
    for (const [id, meta] of Object.entries(j.node ?? {})) {
      if (meta.exportedName) map[meta.exportedName] = id;
    }
  }
  return map;
}

function cookieValue(setCookies: string[], name: string): string {
  for (const c of setCookies) {
    const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (m) return m[1];
  }
  return "";
}

async function postAction(
  action: string,
  path: string,
  args: unknown[],
  cookie = ""
): Promise<{ setCookies: string[]; text: string; status: number }> {
  const id = actionMap()[action];
  if (!id) throw new Error(`action ${action} not found`);
  const body = await encodeReply(args);
  const headers: Record<string, string> = {
    "Next-Action": id,
    Origin: BASE,
    Accept: "text/x-component",
  };
  if (cookie) headers.Cookie = cookie;
  if (typeof body === "string")
    headers["Content-Type"] = "text/plain;charset=UTF-8";
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers,
    body: body as BodyInit,
  });
  const text = await res.text();
  const setCookies = res.headers.getSetCookie();
  return { setCookies, text, status: res.status };
}

async function get(path: string, cookie = "") {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { status: res.status, location: res.headers.get("location") };
}

async function health(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:3100/api/health", {
      signal: AbortSignal.timeout(2000),
    });
    const j = (await r.json()) as { ok?: boolean };
    return r.status === 200 && j.ok === true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("\n=== PHASE D RESTART RECOVERY DRILL ===\n");

  const dbUrl = process.env.DATABASE_URL ?? "";
  check(
    "precondition: staging DATABASE_URL loaded",
    dbUrl.includes(".staging/staging.db")
  );

  // 1. register + session + dashboard pre-restart
  const email = `restart_drill_${Date.now()}@example.test`;
  const fd = new FormData();
  fd.set("name", "Restart Drill");
  fd.set("email", email);
  fd.set("password", "RestartDrill!2026x");
  const reg = await postAction("registerAction", "/register", [null, fd]);
  const sessionCookie = cookieValue(reg.setCookies, "session");
  check("register issues session cookie", !!sessionCookie, reg.text.slice(0, 120));
  const pre = await get("/dashboard", `session=${sessionCookie}`);
  check("pre-restart /dashboard -> 200", pre.status === 200, `status=${pre.status}`);

  const user = await dbUserByEmail(email);

  // 2. hard kill
  const kill = spawnSync(
    'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"',
    { shell: true, encoding: "utf8" }
  );
  await new Promise((r) => setTimeout(r, 1500));
  const down = await health();
  check("server killed (health down)", !down, `health still up? ${down}`);

  // 3. restart detached (append log; staging env inherited from this process)
  const child = spawn(
    "cmd",
    ["/c", "npx next start -p 3100 -H 127.0.0.1 >> .staging\\staging-server.log 2>&1"],
    { detached: true, stdio: "ignore", cwd: process.cwd(), env: process.env }
  );
  child.unref();

  let up = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await health()) {
      up = true;
      break;
    }
  }
  check("server restarted (health 200)", up);
  check("kill helper ran clean", kill.status === 0 || kill.status === null, `status=${kill.status}`);

  if (up && sessionCookie) {
    // 4. same cookie still valid — sessions are DB-backed
    const post = await get("/dashboard", `session=${sessionCookie}`);
    check(
      "same session cookie valid AFTER restart (DB-backed)",
      post.status === 200,
      `status=${post.status} loc=${post.location}`
    );
  } else {
    check("same session cookie valid AFTER restart (DB-backed)", false, "no session/up");
  }

  // 5. full security smoke against restarted server
  const smoke = spawnSync("npx tsx scripts/security-smoke.ts", {
    shell: true,
    encoding: "utf8",
    env: { ...process.env, SMOKE_BASE_URL: BASE },
    maxBuffer: 16 * 1024 * 1024,
  });
  const smokeOut = `${smoke.stdout ?? ""}\n${smoke.stderr ?? ""}`;
  check(
    "security-smoke battery after restart (10/10)",
    smoke.status === 0,
    smokeOut.split("\n").slice(-8).join(" | ")
  );

  // 6. cleanup drill user
  if (user) {
    const c = new PrismaClient();
    await c.supportTicket.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await c.notification.deleteMany({ where: { userId: user.id } });
    await c.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await c.session.deleteMany({ where: { userId: user.id } });
    await c.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await c.$disconnect();
    console.log("  (drill user cleaned up)");
  }

  console.log(`\n=== RESTART DRILL RESULT: ${passed} passed, ${failures.length} failed ===`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failures.length ? 1 : 0);
}

async function dbUserByEmail(email: string) {
  const c = new PrismaClient();
  try {
    return await c.user.findUnique({ where: { email } });
  } finally {
    await c.$disconnect();
  }
}

main().catch((e) => {
  console.error("RESTART DRILL ERROR:", (e as Error).stack ?? e);
  process.exit(1);
});
