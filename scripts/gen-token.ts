import "dotenv/config";
import { randomBytes } from "crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { signSessionToken } from "../src/lib/auth";

const db = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("gen-token refused: NODE_ENV=production (dev utility only)");
    process.exit(1);
  }

  const demo = await db.user.findUniqueOrThrow({
    where: { email: "demo@apexfunds.com" },
  });
  const admin = await db.user.findUniqueOrThrow({
    where: { email: "admin@apexfunds.com" },
  });

  async function token(u: { id: string; role: string }) {
    const jti = randomBytes(16).toString("hex");
    await db.session.create({
      data: {
        id: jti,
        userId: u.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    return signSessionToken({ userId: u.id, role: u.role, jti });
  }

  console.log("DEMO_TOKEN=" + (await token(demo)));
  console.log("ADMIN_TOKEN=" + (await token(admin)));
  await db.$disconnect();
}
main();
