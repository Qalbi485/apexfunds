/**
 * Security smoke: real HTTP checks against the running app (port 3000).
 * Run: start the server first (npm run start), then: npx tsx scripts/security-smoke.ts
 *
 * Phase A terminal-smoke must remain at 23/23; this file adds Phase B checks.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { signSessionToken } from "../src/lib/auth";
import { RATE_LIMITS } from "../src/lib/ratelimit";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const db = new PrismaClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(
  path: string,
  init?: RequestInit & { cookie?: string }
): Promise<{ status: number; location: string | null; body: string }> {
  const headers = new Headers(init?.headers);
  if (init?.cookie) headers.set("cookie", init.cookie);
  const res = await fetch(BASE + path, { redirect: "manual", ...init, headers });
  const body = await res.text();
  return {
    status: res.status,
    location: res.headers.get("location"),
    body,
  };
}

async function main() {
  console.log(`\n═══ SECURITY SMOKE (base ${BASE}) ═══\n`);

  // Setup: temp trader + valid session cookie (forged via same JWT lib)
  const email = `e2e_smoke_${Date.now()}@test.com`;
  const user = await db.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("Smoke123!", 10),
      name: "Smoke",
      referralCode: "SMK" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    },
  });
  const jti = randomBytes(16).toString("hex");
  await db.session.create({
    data: {
      id: jti,
      userId: user.id,
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  const token = await signSessionToken({ userId: user.id, role: "TRADER", jti });
  const cookie = `session=${token}`;

  // 1. Unauthenticated /admin → redirect to /login
  {
    const r = await req("/admin");
    check(
      "GET /admin without session redirects to /login",
      r.status >= 300 && r.status < 400 && (r.location ?? "").includes("/login"),
      `status=${r.status} loc=${r.location}`
    );
  }

  // 2. Trader session on /admin → redirect (not 200, not 500)
  {
    const r = await req("/admin", { cookie });
    check(
      "GET /admin with trader session redirects away",
      r.status >= 300 && r.status < 400,
      `status=${r.status} loc=${r.location}`
    );
  }

  // 3. /admin/audit and /admin/security also protected
  {
    const a = await req("/admin/audit", { cookie });
    const s = await req("/admin/security", { cookie });
    check(
      "GET /admin/audit + /admin/security protected for traders",
      a.status >= 300 && a.status < 400 && s.status >= 300 && s.status < 400,
      `audit=${a.status} security=${s.status}`
    );
  }

  // 4. Auth pages reachable
  {
    const login = await req("/login");
    const forgot = await req("/forgot-password");
    const reset = await req("/reset-password");
    check(
      "GET /login, /forgot-password, /reset-password return 200",
      login.status === 200 && forgot.status === 200 && reset.status === 200,
      `login=${login.status} forgot=${forgot.status} reset=${reset.status}`
    );
  }

  // 4b. Health endpoint: 200, minimal field set, no sensitive data
  {
    const h = await req("/api/health");
    let keys: string[] = [];
    try {
      keys = Object.keys(JSON.parse(h.body));
    } catch {
      /* handled below */
    }
    check(
      "GET /api/health → 200 {ok:true}",
      h.status === 200 && JSON.parse(h.body).ok === true,
      `status=${h.status} body=${h.body.slice(0, 120)}`
    );
    const allowed = ["ok", "db", "uptimeSec", "at"];
    check(
      "health response exposes only expected fields",
      keys.every((k) => allowed.includes(k)) && keys.length > 0,
      JSON.stringify(keys)
    );
  }

  // 4c. Security headers on responses
  {
    const r = await fetch(BASE + "/", { redirect: "manual" });
    const xfo = r.headers.get("x-frame-options");
    const nosniff = r.headers.get("x-content-type-options");
    const refp = r.headers.get("referrer-policy");
    check(
      "security headers present (X-Frame-Options, nosniff, Referrer-Policy)",
      xfo === "DENY" && nosniff === "nosniff" && refp === "strict-origin-when-cross-origin",
      `xfo=${xfo} nosniff=${nosniff} ref=${refp}`
    );
  }

  // 5. Cron: no/wrong bearer → 401
  {
    const noAuth = await req("/api/cron/sync");
    const bad = await req("/api/cron/sync", {
      headers: { authorization: "Bearer wrong_secret_value_xxx" },
    });
    check(
      "GET /api/cron/sync without/wrong bearer → 401",
      noAuth.status === 401 && bad.status === 401,
      `noAuth=${noAuth.status} bad=${bad.status}`
    );
  }

  // 6. Trade API rate limit: burst past the limit → at least one 429.
  // The limiter uses a wall-clock-aligned fixed window (resets each minute),
  // so allow up to 2× the limit + margin: a boundary rollover mid-burst
  // starts a fresh window and the 429 then arrives later in the burst.
  {
    let saw429 = false;
    let last = 0;
    const burst = RATE_LIMITS.tradeOpen.limit * 2 + 5;
    for (let i = 0; i < burst; i++) {
      const r = await req("/api/trades", {
        method: "POST",
        cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: "nonexistent",
          symbol: "EURUSD",
          direction: "UP",
          stake: 10,
          durationSec: 30,
        }),
      });
      last = r.status;
      if (r.status === 429) {
        saw429 = true;
        break;
      }
    }
    check(
      "POST /api/trades rate-limits after burst (429)",
      saw429,
      `last=${last}`
    );
  }

  // 7. Ownership: GET /api/trades?challengeId=... owned by nobody → 404-ish
  {
    const r = await req("/api/trades?challengeId=00000000-0000-0000-0000-000000000000", {
      cookie,
    });
    check(
      "GET /api/trades with foreign challengeId → 4xx",
      r.status >= 400 && r.status < 500,
      `status=${r.status}`
    );
  }

  // Cleanup
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();

  console.log(`\nSecurity smoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
