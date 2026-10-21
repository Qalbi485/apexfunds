export const SITE = {
  name: "ApexFunds",
  tagline: "Trade Binary. Get Funded.",
  description:
    "Prove your skills on our binary trading challenges and get funded up to $100,000. Keep up to 80% of profits.",
  supportEmail: "support@apexfunds.com",
  telegram: "@apexfunds_support",
  minPayout: 50,
  payoutSplitPct: 80, // trader's share of realized trading profit that is payout-eligible
  firstPayoutDays: 14,
  payoutDaysInterval: 14,
  // Payout SLA shown to traders and admins.
  payoutProcessingHours: 24,
  kycRequiredBeforePayout: true, // default; overridable via Setting key kycSettingKey
  kycSettingKey: "kycRequiredBeforePayout",
  // Max sum of OPEN terminal-trade stakes as % of the trading balance.
  maxOpenExposurePct: 50,
  // Payout policy for accounts whose status is FAILED/BREACHED.
  payoutOnBreach: "BLOCK" as "BLOCK" | "ALLOW",
  // ── Hard rules (strict prop-firm mode) ─────────────────────────────
  // Drawdown trails the equity peak: floor = peak × (1 − dd%), NOT
  // start balance. Profits lock in a higher floor — giving back 10%
  // from your best equity busts the account.
  trailingDrawdown: true,
  // Max single-trade stake as % of balance (blocks all-in yolo entries).
  maxStakePct: 30,
  // Max trades opened per UTC day per challenge (anti-overtrading).
  maxTradesPerDay: 30,
  // An untouched account is breached after this many days without a trade.
  inactiveDaysToFail: 14,
} as const;

export type PhaseConfig = {
  phase: "PHASE_1" | "PHASE_2" | "FUNDED";
  targetPct: number;
  maxDailyLossPct: number;
  maxTotalDrawdownPct: number;
  minTradingDays: number;
};

export type PackageSeed = {
  slug: string;
  name: string;
  accountSize: number;
  price: number;
  sortOrder: number;
  phases: PhaseConfig[];
};

const SIZES = [5000, 10000, 25000, 50000, 100000];

function oneStepPackages(): PackageSeed[] {
  return SIZES.map((size, i) => ({
    slug: `ONE_STEP_${size}`,
    name: `1-Step Challenge $${size.toLocaleString()}`,
    accountSize: size,
    price: [49, 99, 199, 349, 599][i],
    sortOrder: i,
    phases: [
      {
        phase: "PHASE_1",
        targetPct: 10,
        maxDailyLossPct: 5,
        maxTotalDrawdownPct: 10,
        minTradingDays: 5,
      },
    ],
  }));
}

function twoStepPackages(): PackageSeed[] {
  return SIZES.map((size, i) => ({
    slug: `TWO_STEP_${size}`,
    name: `2-Step Challenge $${size.toLocaleString()}`,
    accountSize: size,
    price: [39, 79, 159, 299, 499][i],
    sortOrder: 10 + i,
    phases: [
      {
        phase: "PHASE_1",
        targetPct: 8,
        maxDailyLossPct: 5,
        maxTotalDrawdownPct: 10,
        minTradingDays: 5,
      },
      {
        phase: "PHASE_2",
        targetPct: 5,
        maxDailyLossPct: 5,
        maxTotalDrawdownPct: 10,
        minTradingDays: 5,
      },
    ],
  }));
}

function instantPackages(): PackageSeed[] {
  return SIZES.map((size, i) => ({
    slug: `INSTANT_${size}`,
    name: `Instant Funded $${size.toLocaleString()}`,
    accountSize: size,
    price: [199, 349, 599, 999, 1499][i],
    sortOrder: 20 + i,
    phases: [
      {
        phase: "FUNDED",
        targetPct: 0,
        maxDailyLossPct: 3,
        maxTotalDrawdownPct: 6,
        minTradingDays: 0,
      },
    ],
  }));
}

export const DEFAULT_PACKAGES: PackageSeed[] = [
  ...oneStepPackages(),
  ...twoStepPackages(),
  ...instantPackages(),
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  usdtTrc20: process.env.USDT_TRC20_ADDRESS || "",
  usdtErc20: process.env.USDT_ERC20_ADDRESS || "",
  maintenanceMode: "false",
};

/** Accounts created by prisma/seed.ts — must not work in production. */
export const SEED_ACCOUNT_EMAILS = [
  "admin@apexfunds.com",
  "demo@apexfunds.com",
  "trader1@example.com",
  "trader2@example.com",
] as const;

/**
 * Production guard: seed/demo credentials are rejected at login unless
 * ALLOW_SEED_LOGIN=true is explicitly set (break-glass for local prod
 * testing only). Pure function so tests can exercise both branches.
 */
export function seedLoginBlocked(
  email: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (env.ALLOW_SEED_LOGIN === "true") return false;
  return (SEED_ACCOUNT_EMAILS as readonly string[]).includes(
    email.toLowerCase()
  );
}

const SECRET_PLACEHOLDER =
  /(changeme|change[_-]?(me|this|it)|your[_-]?(secret|domain|key)|placeholder|replace[_-]?me|example\.com|^example$|^demo$|fixme|^todo$|xxx+|^test$|password)/i;

/**
 * Production secret hygiene: returns a human-readable PROBLEM description or
 * null when the value is acceptable. Never echoes the value back (safe for
 * logs/reports). Pure — exercised by tests.
 */
export function secretProblem(
  name: string,
  value: string | undefined,
  minLen = 32
): string | null {
  if (!value || !value.trim()) return `${name} is missing`;
  const v = value.trim();
  if (v.length < minLen)
    return `${name} is shorter than ${minLen} characters`;
  if (SECRET_PLACEHOLDER.test(v))
    return `${name} matches a known placeholder pattern`;
  return null;
}

/**
 * Module-load guard for production: throws (fail-fast, value never shown)
 * when a required secret is missing/weak/placeholder. Inert outside
 * production so local dev and tests keep working.
 */
export function assertProductionSecret(name: string, value: string | undefined): void {
  if (process.env.NODE_ENV !== "production") return;
  const problem = secretProblem(name, value);
  if (problem)
    throw new Error(
      `[config] Refusing to start: ${problem}. Generate a strong value (e.g. node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"). The value itself is never printed.`
    );
}
