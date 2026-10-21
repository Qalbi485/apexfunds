/**
 * PHASE D staging gate — production-mode HTTP checks against the STAGING
 * server (default http://localhost:3100) using the staging DB and secrets
 * from .staging/staging.env (load it BEFORE running; values never printed).
 *
 * Drives real Server Actions over the wire (Next-Action header +
 * react-server-dom encodeReply) — the same protocol the browser uses.
 * Only staging test records are created; no production data is touched.
 */
import "dotenv/config";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { signSessionToken } from "../src/lib/auth";
import { totpCode } from "../src/lib/totp";

/* eslint-disable @typescript-eslint/no-require-imports */
const { encodeReply } = require(
  "next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.node.production.js"
) as { encodeReply: (v: unknown) => Promise<string | FormData> };

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const LOG_FILE = process.env.STAGING_LOG ?? join(".staging", "staging-server.log");
const db = new PrismaClient();

const GATE_EMAIL = `e2e_gate_${Date.now()}@test.com`;
const GATE_PASSWORD = "StagingGate!2026x9";
const ADMIN_EMAIL = "admin@apexfunds.com";
const ADMIN_PASSWORD = "Admin@12345";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function actionMap(): Record<string, string> {
  const map: Record<string, string> = {};
  // Primary: server-reference-manifest (covers server AND client actions).
  const manifest = join(".next", "server", "server-reference-manifest.json");
  if (existsSync(manifest)) {
    const j = JSON.parse(readFileSync(manifest, "utf8")) as {
      node?: Record<string, { exportedName?: string }>;
    };
    for (const [id, meta] of Object.entries(j.node ?? {})) {
      if (meta.exportedName) map[meta.exportedName] = id;
    }
  }
  // Fallback: labelled createServerReference in client chunks.
  const dir = join(".next", "static", "chunks");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const t = readFileSync(join(dir, f), "utf8");
    const re = /createServerReference\)\("([0-9a-f]+)"[^)]*,"([A-Za-z0-9_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) if (!map[m[2]]) map[m[2]] = m[1];
  }
  return map;
}
const ACTIONS = actionMap();

type ActionRes = {
  status: number;
  location: string | null;
  text: string;
  setCookies: string[];
};

async function callAction(
  name: string,
  path: string,
  args: unknown[],
  cookie?: string
): Promise<ActionRes> {
  const id = ACTIONS[name];
  if (!id) throw new Error(`action ${name} not found in build chunks`);
  const body = await encodeReply(args);
  const headers: Record<string, string> = {
    "Next-Action": id,
    Origin: BASE,
    Accept: "text/x-component",
  };
  if (cookie) headers.cookie = cookie;
  if (typeof body === "string")
    headers["Content-Type"] = "text/plain;charset=UTF-8";
  const res = await fetch(BASE + path, {
    method: "POST",
    redirect: "manual",
    headers,
    body: body as BodyInit,
  });
  const text = await res.text();
  const location =
    res.headers.get("location") ?? res.headers.get("x-action-redirect");
  return {
    status: res.status,
    location,
    text,
    setCookies: res.headers.getSetCookie(),
  };
}

function flightError(text: string): string | null {
  const m = text.match(/\{"error":"((?:[^"\\]|\\.)*)"\}/);
  return m ? m[1] : null;
}
function flightSuccess(text: string): string | null {
  const m = text.match(/\{"success":"((?:[^"\\]|\\.)*)"\}/);
  return m ? m[1] : null;
}
function cookieValue(setCookies: string[], name: string): string | null {
  for (const c of setCookies) {
    const m = c.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}
function cookieFlags(setCookies: string[], name: string) {
  const c = setCookies.find((x) => x.startsWith(`${name}=`)) ?? "";
  return {
    httpOnly: /httponly/i.test(c),
    secure: /secure/i.test(c),
    sameSite: /samesite=(lax|strict)/i.test(c),
  };
}

async function forgeSession(
  userId: string,
  role: string,
  ageSec = 0
): Promise<string> {
  const jti = randomBytes(16).toString("hex");
  await db.session.create({
    data: { id: jti, userId, expiresAt: new Date(Date.now() + 600_000) },
  });
  const tok = await signSessionToken({
    userId,
    role,
    jti,
    issuedAt: Math.floor(Date.now() / 1000) - ageSec,
  });
  return `session=${tok}`;
}

async function get(path: string, cookie?: string) {
  const res = await fetch(BASE + path, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
  const body = await res.text();
  return {
    status: res.status,
    location: res.headers.get("location"),
    body,
    headers: res.headers,
  };
}

async function postJson(path: string, cookie: string, data: unknown) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  console.log(`\n=== PHASE D STAGING GATE (base ${BASE}) ===\n`);

  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length !== 64)
    throw new Error("staging SESSION_SECRET not loaded (.staging/staging.env)");

  // Startup cleanup: leftovers from any previous crashed gate run (staging only).
  {
    const stale = await db.user.findMany({
      where: { email: { startsWith: "e2e_gate_" } },
      select: { id: true },
    });
    const ids = stale.map((u) => u.id);
    if (ids.length) {
      const chs = await db.challenge.findMany({
        where: { userId: { in: ids } },
        select: { id: true },
      });
      const chIds = chs.map((c) => c.id);
      if (chIds.length) {
        await db.trade.deleteMany({ where: { challengeId: { in: chIds } } });
        await db.payout.deleteMany({ where: { challengeId: { in: chIds } } });
        await db.challenge.deleteMany({ where: { id: { in: chIds } } });
      }
      await db.payment.deleteMany({ where: { userId: { in: ids } } });
      await db.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
      await db.notification.deleteMany({ where: { userId: { in: ids } } });
      await db.session.deleteMany({ where: { userId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      console.log(`  (cleaned ${ids.length} leftover gate user(s))`);
    }
  }

  // 1. Seed/demo credentials blocked in production — tested with the REAL
  //    seed passwords (the guard fires after bcrypt succeeds; a wrong
  //    password would only exercise the generic login_failed path).
  for (const [email, pw] of [
    [ADMIN_EMAIL, ADMIN_PASSWORD],
    ["demo@apexfunds.com", "Demo@12345"],
  ] as const) {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", pw);
    const r = await callAction("loginAction", "/login", [null, fd]);
    const err = flightError(r.text);
    check(
      `seed login blocked with VALID credentials (${email.split("@")[0]})`,
      err === "Invalid email or password" && r.setCookies.length === 0,
      `err=${err} cookies=${r.setCookies.length}`
    );
  }

  // 2. Registration + real login (production)
  const regFd = new FormData();
  regFd.set("name", "Gate Tester");
  regFd.set("email", GATE_EMAIL);
  regFd.set("password", GATE_PASSWORD);
  const reg = await callAction("registerAction", "/register", [null, regFd]);
  const gateUser = await db.user.findUnique({ where: { email: GATE_EMAIL } });
  check(
    "registration creates account",
    !!gateUser && !flightError(reg.text),
    flightError(reg.text) ?? ""
  );

  const loginFd = new FormData();
  loginFd.set("email", GATE_EMAIL);
  loginFd.set("password", GATE_PASSWORD);
  const login = await callAction("loginAction", "/login", [null, loginFd]);
  const sessionCookie = cookieValue(login.setCookies, "session");
  const flags = cookieFlags(login.setCookies, "session");
  check(
    "login issues session cookie",
    !!sessionCookie,
    `setCookies=${login.setCookies.length} err=${flightError(login.text)}`
  );
  check(
    "session cookie flags HttpOnly+Secure+SameSite",
    flags.httpOnly && flags.secure && flags.sameSite,
    JSON.stringify(flags)
  );
  let userCookie = sessionCookie ? `session=${sessionCookie}` : "";
  if (!gateUser) throw new Error("gate user missing");

  // 3. Password reset hygiene
  {
    const fd = new FormData();
    fd.set("email", GATE_EMAIL);
    const r = await callAction(
      "requestPasswordResetAction",
      "/forgot-password",
      [null, fd]
    );
    const success = flightSuccess(r.text) ?? "";
    const row = await db.passwordResetToken.findFirst({
      where: { userId: gateUser.id },
      orderBy: { createdAt: "desc" },
    });
    check(
      "reset: generic success, no enumeration",
      success.includes("If that email has an account"),
      success.slice(0, 80)
    );
    check(
      "reset token stored hashed at rest",
      !!row && /^[0-9a-f]{64}$/.test(row.tokenHash),
      row ? `hashLen=${row.tokenHash.length}` : "no row"
    );
    check(
      "reset response does not leak token hash",
      !!row && !r.text.includes(row.tokenHash)
    );
  }

  // 4. Cron auth + batch/retry semantics
  {
    const r = await fetch(BASE + "/api/cron/sync", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const j = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      total?: number;
      errors?: unknown;
    };
    check(
      "cron valid bearer -> 200 batch summary",
      r.status === 200 &&
        j.ok === true &&
        typeof j.total === "number" &&
        Array.isArray(j.errors),
      JSON.stringify(j).slice(0, 160)
    );
    const r2 = await fetch(BASE + "/api/cron/sync", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const j2 = (await r2.json().catch(() => ({}))) as { ok?: boolean };
    check(
      "cron rerun (retry) -> 200 again, no crash",
      r2.status === 200 && j2.ok === true
    );
    const rEmpty = await fetch(BASE + "/api/cron/sync", {
      headers: { authorization: "Bearer " },
    });
    check("cron empty bearer -> 401", rEmpty.status === 401, String(rEmpty.status));
  }

  // 5. Step-up enforcement over HTTP (aged admin must be blocked)
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const freshAdmin = await forgeSession(admin.id, "ADMIN", 0);
  const agedAdmin = await forgeSession(admin.id, "ADMIN", 11 * 60);

  async function roleAction(cookie: string): Promise<"ADMIN" | "TRADER"> {
    const fd = new FormData();
    fd.set("userId", gateUser!.id);
    fd.set("role", "ADMIN");
    await callAction("setUserRoleAction", "/admin/users", [null, fd], cookie);
    const u = await db.user.findUniqueOrThrow({ where: { id: gateUser!.id } });
    return u.role as "ADMIN" | "TRADER";
  }

  const blockedRole = await roleAction(agedAdmin);
  check(
    "aged admin blocked without step-up (role unchanged)",
    blockedRole === "TRADER",
    `role=${blockedRole}`
  );

  // 6. Admin 2FA enroll + reverify(TOTP) unlocks step-up
  await db.setting.upsert({
    where: { key: "adminTwoFactor" },
    update: { value: "true" },
    create: { key: "adminTwoFactor", value: "true" },
  });
  let totpSecret = "";
  {
    const start = await callAction(
      "enableTotpStartAction",
      "/admin/security",
      [],
      freshAdmin
    );
    const m = start.text.match(/"secret":"([A-Z2-7]+)"/);
    totpSecret = m ? m[1] : "";
    check("admin 2FA: enrollment starts (fresh admin)", !!totpSecret);

    const fd = new FormData();
    fd.set("code", totpCode(totpSecret));
    const conf = await callAction(
      "enableTotpConfirmAction",
      "/admin/security",
      [null, fd],
      freshAdmin
    );
    const u = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    check(
      "admin 2FA: TOTP confirmed and enabled",
      u.totpEnabled === true && !flightError(conf.text),
      flightError(conf.text) ?? ""
    );
  }
  {
    const fd = new FormData();
    fd.set("password", ADMIN_PASSWORD);
    fd.set("totp", totpCode(totpSecret));
    const r = await callAction(
      "reverifyAction",
      "/admin/security",
      [null, fd],
      agedAdmin
    );
    const stepCookie = cookieValue(r.setCookies, "stepup");
    check(
      "reverify with password+TOTP issues step-up cookie",
      !!stepCookie,
      flightError(r.text) ?? `cookies=${r.setCookies.length}`
    );
    const roleAfter = await roleAction(
      stepCookie ? `stepup=${stepCookie}; ${agedAdmin}` : agedAdmin
    );
    check(
      "aged admin + 2FA step-up cookie can change role",
      roleAfter === "ADMIN",
      `role=${roleAfter}`
    );
    const fd2 = new FormData();
    fd2.set("userId", gateUser.id);
    fd2.set("role", "TRADER");
    await callAction("setUserRoleAction", "/admin/users", [null, fd2], freshAdmin);
    // NOTE: setUserRoleAction revokes ALL sessions of the target user
    // (privilege-change hygiene) — the gate user's login session died above,
    // so re-login before the flow sections. This also proves revocation works.
    const rel = await db.session.count({ where: { userId: gateUser.id, revokedAt: null } });
    check("role change revoked gate user sessions (hygiene)", rel === 0, `active=${rel}`);
    const fd3 = new FormData();
    fd3.set("email", GATE_EMAIL);
    fd3.set("password", GATE_PASSWORD);
    const relogin = await callAction("loginAction", "/login", [null, fd3]);
    const freshUserCookieValue = cookieValue(relogin.setCookies, "session");
    check(
      "gate user can re-login after revocation",
      !!freshUserCookieValue,
      flightError(relogin.text) ?? ""
    );
    userCookie = freshUserCookieValue ? `session=${freshUserCookieValue}` : "";
  }

  // 7. Admin surfaces: admin 200 / trader redirected
  {
    const a = await get("/admin/users", freshAdmin);
    const t = await get("/admin/users", userCookie);
    const au = await get("/admin/audit", freshAdmin);
    check(
      "admin pages 200 for admin, redirect for trader",
      a.status === 200 &&
        au.status === 200 &&
        t.status >= 300 &&
        t.status < 400,
      `users=${a.status} audit=${au.status} trader=${t.status}`
    );
  }

  // 8. Health + production headers
  {
    const h = await get("/api/health");
    const j = JSON.parse(h.body) as { ok?: boolean };
    check("health -> 200 {ok:true}", h.status === 200 && j.ok === true);
    check(
      "HSTS header present (production)",
      !!h.headers.get("strict-transport-security")
    );
  }

  // 9. Purchase -> checkout -> admin confirm (test payment)
  const pkg = await db.package.findFirst({
    where: { active: true },
    orderBy: { price: "asc" },
  });
  if (!pkg) throw new Error("no active package");
  let paymentId = "";
  {
    const r = await callAction(
      "purchaseChallengeAction",
      "/",
      [pkg.id, new FormData()],
      userCookie
    );
    const m =
      (r.location ?? "").match(/\/checkout\/([A-Za-z0-9_-]+)/) ??
      r.text.match(/\/checkout\/([A-Za-z0-9_-]+)/);
    paymentId = m ? m[1] : "";
    check(
      "purchase redirects to /checkout/<paymentId>",
      !!paymentId,
      `status=${r.status} loc=${r.location} err=${flightError(r.text)}`
    );
    const payment = paymentId
      ? await db.payment.findUnique({ where: { id: paymentId } })
      : null;
    const challenge = payment
      ? await db.challenge.findUnique({ where: { id: payment.challengeId! } })
      : null;
    check(
      "payment PENDING (test amount) + challenge PENDING_PAYMENT",
      !!payment &&
        payment.amount === pkg.price &&
        payment.status === "PENDING" &&
        challenge?.status === "PENDING_PAYMENT",
      JSON.stringify({ amt: payment?.amount, st: payment?.status, ch: challenge?.status })
    );
  }
  {
    const r = await callAction(
      "confirmPaymentAction",
      "/admin/users",
      [paymentId],
      freshAdmin
    );
    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    const challenge = payment
      ? await db.challenge.findUnique({ where: { id: payment.challengeId! } })
      : null;
    check(
      "admin confirm -> payment CONFIRMED + challenge ACTIVE",
      payment?.status === "CONFIRMED" && challenge?.status === "ACTIVE",
      flightError(r.text) ?? JSON.stringify({ p: payment?.status, c: challenge?.status })
    );
    const audit = await db.auditLog.findFirst({
      where: { action: "PAYMENT_CONFIRMED", entityId: paymentId },
      orderBy: { createdAt: "desc" },
    });
    check(
      "PAYMENT_CONFIRMED audit row records actor",
      !!audit && audit.actorId === admin.id && audit.outcome === "SUCCESS",
      JSON.stringify({ actor: audit?.actorId, outcome: audit?.outcome })
    );
  }

  // 10. Trade open on purchased challenge (REST, rules engine)
  const purchased = paymentId
    ? await db.payment.findUnique({ where: { id: paymentId } })
    : null;
  const openChallenge = purchased
    ? await db.challenge.findUnique({ where: { id: purchased.challengeId! } })
    : null;
  if (openChallenge) {
    const before = await db.challenge.findUniqueOrThrow({
      where: { id: openChallenge.id },
    });
    const open = await postJson("/api/trades", userCookie, {
      challengeId: openChallenge.id,
      symbol: "EURUSD",
      direction: "UP",
      stake: 10,
      durationSec: 60,
    });
    const after = await db.challenge.findUniqueOrThrow({
      where: { id: openChallenge.id },
    });
    check(
      "trade opens; reservedExposure +10 (funds+cap rule)",
      open.status === 200 &&
        after.reservedExposure === before.reservedExposure + 10,
      JSON.stringify(open.body).slice(0, 120)
    );
    const over = await postJson("/api/trades", userCookie, {
      challengeId: openChallenge.id,
      symbol: "EURUSD",
      direction: "UP",
      stake: 9_999_999,
      durationSec: 60,
    });
    check("oversized stake rejected", over.status === 400, String(over.status));
  }

  // 11. Payout request -> approve -> PAID ledger (STAGING TEST RECORDS ONLY)
  // KYC gate is ON by default — give the gate user an approved KYC first.
  await db.kyc.upsert({
    where: { userId: gateUser.id },
    update: { status: "APPROVED" },
    create: {
      userId: gateUser.id,
      fullName: "Staging Gate Tester",
      country: "PK",
      documentType: "ID_CARD",
      documentNumber: "42101-1234567-9",
      status: "APPROVED",
    },
  });
  const payoutChallenge = await db.challenge.create({
    data: {
      userId: gateUser.id,
      packageId: pkg.id,
      type: "ONE_STEP",
      phase: "FUNDED",
      status: "FUNDED",
      accountSize: 5000,
      startBalance: 5000,
      currentBalance: 6000,
      peakBalance: 6000,
      profitTarget: 5500,
      maxDailyLoss: 250,
      maxTotalDrawdown: 500,
      consistencyPct: 40,
      minTradingDays: 0,
      brokerAccountId: "STAGING-GATE-TEST",
      fundedAt: new Date(Date.now() - 15 * 86400000),
    },
  });
  let payoutId = "";
  {
    const fd = new FormData();
    fd.set("challengeId", payoutChallenge.id);
    fd.set("amount", "100");
    fd.set("walletAddress", "TStagingGateTestWallet111");
    fd.set("network", "TRC20");
    const r = await callAction(
      "requestPayoutAction",
      "/dashboard/payouts",
      [null, fd],
      userCookie
    );
    const p = await db.payout.findFirst({
      where: { challengeId: payoutChallenge.id },
      orderBy: { createdAt: "desc" },
    });
    payoutId = p?.id ?? "";
    check(
      "payout request via HTTP -> REQUESTED (test record)",
      !!p && p.status === "REQUESTED" && p.amount === 100,
      flightError(r.text) ?? JSON.stringify(p && { s: p.status, a: p.amount })
    );
  }
  {
    const r1 = await callAction(
      "processPayoutAction",
      "/admin/users",
      [payoutId, "APPROVED"],
      freshAdmin
    );
    const mid = await db.payout.findUnique({ where: { id: payoutId } });
    check(
      "admin approves payout (test record)",
      mid?.status === "APPROVED",
      flightError(r1.text) ?? String(mid?.status)
    );
    const r2 = await callAction(
      "processPayoutAction",
      "/admin/users",
      [payoutId, "PAID"],
      freshAdmin
    );
    const done = await db.payout.findUnique({ where: { id: payoutId } });
    const chAfter = await db.challenge.findUniqueOrThrow({
      where: { id: payoutChallenge.id },
    });
    check(
      "PAID: paidWithdrawals += 100",
      done?.status === "PAID" &&
        Math.abs(chAfter.paidWithdrawals - 100) < 0.005,
      flightError(r2.text) ??
        JSON.stringify({ p: done?.status, paid: chAfter.paidWithdrawals })
    );
    const share = Math.max(0, (chAfter.currentBalance - chAfter.startBalance) * 0.8);
    check(
      "ledger invariant: paid <= 80% share",
      chAfter.paidWithdrawals <= share + 0.005,
      `paid=${chAfter.paidWithdrawals} share=${share}`
    );
    const audit = await db.auditLog.findFirst({
      where: { action: "PAYOUT_PAID", entityId: payoutId },
      orderBy: { createdAt: "desc" },
    });
    check(
      "PAYOUT_PAID audit row records actor",
      !!audit && audit.actorId === admin.id,
      JSON.stringify({ actor: audit?.actorId })
    );
  }

  // 12. Log hygiene: secrets/passwords/tokens must never appear
  await new Promise((r) => setTimeout(r, 1500));
  {
    const log = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : "";
    const forbidden: Array<[string, boolean]> = [
      ["SESSION_SECRET value", log.includes(process.env.SESSION_SECRET ?? " ")],
      ["CRON_SECRET value", log.includes(process.env.CRON_SECRET ?? " ")],
      ["gate password", log.includes(GATE_PASSWORD)],
      ["admin password", log.includes(ADMIN_PASSWORD)],
      ["TOTP secret", totpSecret ? log.includes(totpSecret) : false],
      ["reset URL", /reset-password\?/.test(log)],
    ];
    for (const [label, present] of forbidden) {
      check(`log does NOT contain ${label}`, !present);
    }
    check("log records seed_login_blocked", log.includes("seed_login_blocked"));
    check("log records reverify_success", log.includes("reverify_success"));
    check(
      "log records password_reset_email_unavailable (SMTP unconfigured)",
      log.includes("password_reset_email_unavailable")
    );
    if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(log))
      console.log(
        "  (observation) logs contain an email (seed_login_blocked ops logging) — review PII policy"
      );
  }

  // Cleanup staging test records (audit rows kept as gate evidence)
  await db.payout.deleteMany({ where: { challengeId: payoutChallenge.id } });
  await db.challenge.deleteMany({ where: { id: payoutChallenge.id } });
  if (openChallenge)
    await db.challenge.deleteMany({ where: { id: openChallenge.id } });
  await db.payment.deleteMany({ where: { userId: gateUser.id } });
  await db.passwordResetToken.deleteMany({ where: { userId: gateUser.id } });
  await db.notification.deleteMany({ where: { userId: gateUser.id } });
  await db.session.deleteMany({ where: { userId: gateUser.id } });
  await db.user.delete({ where: { id: gateUser.id } }).catch(() => undefined);
  await db.user.update({
    where: { id: admin.id },
    data: { totpEnabled: false, totpSecret: null },
  });
  await db.setting
    .update({ where: { key: "adminTwoFactor" }, data: { value: "false" } })
    .catch(() => undefined);
  await db.session.deleteMany({ where: { userId: admin.id } });
  await db.$disconnect();

  console.log(`\n=== GATE RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("GATE ERROR:", (e as Error).stack ?? e);
  process.exit(1);
});
