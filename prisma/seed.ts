import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_PACKAGES, DEFAULT_SETTINGS } from "../src/lib/config";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  // Production guard: never create/update the seed admin account unless
  // explicitly allowed. Packages and settings always seed.
  const skipSeedAccounts =
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_SEED_LOGIN !== "true";

  if (skipSeedAccounts) {
    console.log(
      "Seed: SKIPPED demo admin account (NODE_ENV=production, ALLOW_SEED_LOGIN not set)"
    );
  } else {
    const passwordHash = await bcrypt.hash("Admin@12345", 10);
    await db.user.upsert({
      where: { email: "admin@apexfunds.com" },
      update: { role: "ADMIN" },
      create: {
        email: "admin@apexfunds.com",
        passwordHash,
        name: "Admin",
        role: "ADMIN",
        referralCode: "ADMIN001",
      },
    });
  }

  for (const p of DEFAULT_PACKAGES) {
    await db.package.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        accountSize: p.accountSize,
        price: p.price,
        sortOrder: p.sortOrder,
        phasesJson: JSON.stringify(p.phases),
        active: true,
      },
      create: {
        slug: p.slug,
        name: p.name,
        accountSize: p.accountSize,
        price: p.price,
        sortOrder: p.sortOrder,
        phasesJson: JSON.stringify(p.phases),
        rulesJson: JSON.stringify(p.phases[0]),
        active: true,
      },
    });
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!value) continue;
    await db.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  console.log("Seed complete: admin + packages + settings");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
