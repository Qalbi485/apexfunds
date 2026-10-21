/**
 * Production-safe first-admin bootstrap (deploy checklist: "create the first
 * admin"). Unlike `npm run db:seed`, this does NOT depend on the shared demo
 * password and does NOT require ALLOW_SEED_LOGIN=true.
 *
 * Usage (on the VPS, in web/):
 *   ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='strong-passphrase' npm run db:create-admin
 *   # name defaults to "Administrator"; override with ADMIN_NAME=...
 *   # or: npm run db:create-admin -- --email you@x.com --name "Owner"
 *   #     (password is then read from ADMIN_PASSWORD or a hidden prompt)
 *
 * The password is never echoed back and never logged. Re-running without
 * --force when an admin already exists is refused, so this can't silently
 * mint a second owner. On success any live sessions for that user are
 * revoked (password-change hygiene) — the admin must log in fresh.
 */
import "dotenv/config";
import { createInterface } from "readline";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { randomCode } from "../src/lib/utils";

const db = new PrismaClient();

const SEED_PASSWORD = "Admin@12345";
const MIN_PASSWORD_LEN = 12;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const mutable = rl as unknown as {
      _writeToOutput?: (s: string) => void;
    };
    mutable._writeToOutput = () => undefined;
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function passwordProblem(pw: string): string | null {
  if (!pw) return "password is empty";
  if (pw.length < MIN_PASSWORD_LEN)
    return `password must be at least ${MIN_PASSWORD_LEN} characters`;
  if (pw === SEED_PASSWORD) return "password is the known seed/demo password";
  return null;
}

async function nextReferralCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomCode();
    if (!(await db.user.findUnique({ where: { referralCode: code } })))
      return code;
  }
  throw new Error("could not allocate a unique referral code");
}

async function main() {
  const force = process.argv.includes("--force");

  const email = (
    arg("--email") ??
    process.env.ADMIN_EMAIL ??
    ""
  )
    .trim()
    .toLowerCase();
  const name = (arg("--name") ?? process.env.ADMIN_NAME ?? "Administrator").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(
      "Refused: provide a valid admin email via ADMIN_EMAIL=... (or --email)."
    );
    process.exit(1);
  }

  let password = arg("--password") ?? process.env.ADMIN_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error(
        "Refused: no password provided. Set ADMIN_PASSWORD=... (or pipe one in)."
      );
      process.exit(1);
    }
    password = await promptHidden(`Password for ${email}: `);
  }

  const pwProblem = passwordProblem(password);
  if (pwProblem) {
    console.error(`Refused: ${pwProblem}.`);
    process.exit(1);
  }

  const adminCount = await db.user.count({ where: { role: "ADMIN" } });
  if (adminCount > 0 && !force) {
    console.error(
      `Refused: ${adminCount} admin account(s) already exist. ` +
        "Use the admin UI, or re-run with --force to create/promote anyway."
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await db.user.findUnique({ where: { email } });

  if (existing) {
    await db.user.update({
      where: { email },
      data: { passwordHash, name, role: "ADMIN" },
    });
    await db.session.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    console.log(`Promoted/reset admin: ${email} (role=ADMIN)`);
  } else {
    const referralCode = await nextReferralCode();
    const user = await db.user.create({
      data: { email, passwordHash, name, role: "ADMIN", referralCode },
    });
    console.log(`Created admin: ${user.email} (role=ADMIN)`);
  }

  console.log(
    "Next: log in, change the password, and enroll 2FA (Admin → Security)."
  );
}

main()
  .catch((e) => {
    console.error((e as Error).message ?? e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
