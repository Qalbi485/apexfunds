// Generates the Postgres schema used by Firebase App Hosting / Cloud Run.
// Local development keeps SQLite (zero-config tests); production uses
// Postgres (Neon / Cloud SQL) because Cloud Run has no persistent disk.
//
//   node scripts/prepare-pg-schema.mjs && npx prisma generate --schema prisma/schema.postgres.prisma
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
if (!src.includes('provider = "sqlite"')) {
  console.error("prisma/schema.prisma is not sqlite — refusing to rewrite");
  process.exit(1);
}
const out = src.replace('provider = "sqlite"', 'provider = "postgresql"');
writeFileSync(new URL("../prisma/schema.postgres.prisma", import.meta.url), out);
console.log("wrote prisma/schema.postgres.prisma");
