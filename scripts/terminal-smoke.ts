import "dotenv/config";
import { randomBytes } from "crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { signSessionToken } from "../src/lib/auth";
import { SYMBOLS } from "../src/lib/market";

const db = new PrismaClient();
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

async function token(userId: string, role: string, jti: string) {
  return signSessionToken({ userId, role, jti });
}

async function api(
  method: string,
  path: string,
  session: string,
  body?: unknown
) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${session}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function main() {
  const demo = await db.user.findUniqueOrThrow({
    where: { email: "demo@apexfunds.com" },
  });
  const jti = randomBytes(16).toString("hex");
  await db.session.create({
    data: {
      id: jti,
      userId: demo.id,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const session = await token(demo.id, demo.role, jti);

  const challenge = await db.challenge.findFirstOrThrow({
    where: { userId: demo.id, status: { in: ["ACTIVE", "FUNDED"] } },
    orderBy: { createdAt: "desc" },
  });
  const bal0 = challenge.currentBalance;
  console.log(`\n═══ TERMINAL SMOKE TEST ═══`);
  console.log(`challenge=${challenge.id} balance=${bal0}`);

  console.log("\n— auth + list —");
  const unauth = await fetch(`${BASE}/api/trades?challengeId=${challenge.id}`);
  check("unauthenticated → 401", unauth.status === 401);

  const list = await api("GET", `/api/trades?challengeId=${challenge.id}`, session);
  check("list trades → 200", list.status === 200, JSON.stringify(list.data));
  check("challenge snapshot present", !!list.data.challenge);

  console.log("\n— validation —");
  const badStake = await api("POST", "/api/trades", session, {
    challengeId: challenge.id,
    symbol: "EURUSD",
    direction: "UP",
    stake: 0,
    durationSec: 30,
  });
  check("stake < 1 rejected", badStake.status === 400);

  const badSym = await api("POST", "/api/trades", session, {
    challengeId: challenge.id,
    symbol: "FAKEPAIR",
    direction: "UP",
    stake: 10,
    durationSec: 30,
  });
  check("unknown symbol rejected", badSym.status === 400);

  const huge = await api("POST", "/api/trades", session, {
    challengeId: challenge.id,
    symbol: "EURUSD",
    direction: "UP",
    stake: 9_999_999,
    durationSec: 30,
  });
  check("stake > balance rejected", huge.status === 400);

  console.log("\n— open 30s trade —");
  const open = await api("POST", "/api/trades", session, {
    challengeId: challenge.id,
    symbol: "EURUSD",
    direction: "UP",
    stake: 10,
    durationSec: 30,
  });
  check("open trade → 200", open.status === 200, JSON.stringify(open.data));
  const tradeId = open.data.tradeId;
  if (!tradeId) throw new Error("no tradeId");

  const row = await db.trade.findUniqueOrThrow({ where: { id: tradeId } });
  check("status OPEN", row.status === "OPEN");
  check("entry price stored", !!row.entryPrice);
  check(
    "payout pct stored",
    row.payoutPct === SYMBOLS.EURUSD.payout,
    String(row.payoutPct)
  );
  check(
    "expiry = now + 30s",
    Math.abs(row.expiryAt!.getTime() - Date.now() - 30000) < 3000
  );

  console.log("\n— premature settle rejected —");
  const early = await api("POST", "/api/trades/settle", session, { tradeId });
  check("not expired → 400", early.status === 400);

  const overs = await api("POST", "/api/trades", session, {
    challengeId: challenge.id,
    symbol: "GBPUSD",
    direction: "DOWN",
    stake: 10,
    durationSec: 30,
  });
  check("second concurrent trade allowed", overs.status === 200);

  console.log("\n— waiting 31s for expiry … —");
  await new Promise((r) => setTimeout(r, 31000));

  console.log("\n— settle —");
  const s1 = await api("POST", "/api/trades/settle", session, { tradeId });
  check("settle → 200", s1.status === 200, JSON.stringify(s1.data));
  check("settle returns profit", typeof s1.data.profit === "number");
  check(
    "settle returns challenge snapshot",
    !!s1.data.challenge?.currentBalance
  );

  const s1again = await api("POST", "/api/trades/settle", session, { tradeId });
  check("double settle → 400", s1again.status === 400);

  const s2 = await api("POST", "/api/trades/settle", session, {
    tradeId: overs.data.tradeId,
  });
  check("second trade settles too", s2.status === 200, JSON.stringify(s2.data));

  const t1 = await db.trade.findUniqueOrThrow({ where: { id: tradeId } });
  const t2 = await db.trade.findUniqueOrThrow({
    where: { id: overs.data.tradeId },
  });
  check("trade CLOSED in db", t1.status === "CLOSED");
  check("close price stored", !!t1.closePrice);
  check("second trade CLOSED", t2.status === "CLOSED");

  const after = await db.challenge.findUniqueOrThrow({
    where: { id: challenge.id },
  });
  const expected = bal0 + (t1.profit ?? 0) + (t2.profit ?? 0);
  console.log(
    `balance: ${bal0} → ${after.currentBalance} (profits: ${t1.profit}, ${t2.profit})`
  );
  check(
    "balance updated by rules engine",
    Math.abs(after.currentBalance - expected) < 0.01,
    `got ${after.currentBalance}, expected ${expected}`
  );

  const list2 = await api("GET", `/api/trades?challengeId=${challenge.id}`, session);
  const closedList = list2.data.closed || [];
  check("closed trades listed", closedList.length >= 2);

  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
  await db.session.deleteMany({ where: { id: jti } });
  if (failed > 0) process.exitCode = 1;
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
