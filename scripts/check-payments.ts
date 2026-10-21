import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
const db = new PrismaClient();
db.payment
  .findMany({
    include: {
      user: { select: { email: true } },
      challenge: { include: { package: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  })
  .then(async (p) => {
    console.log(JSON.stringify(p, null, 2));
    await db.$disconnect();
  });
