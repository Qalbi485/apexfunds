import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Terminal } from "@/components/terminal";

export default async function TradePage() {
  const user = await requireUser();

  const challenges = await db.challenge.findMany({
    where: { userId: user.id, status: { in: ["ACTIVE", "FUNDED"] } },
    include: { package: true },
    orderBy: { createdAt: "desc" },
  });

  const options = challenges.map((c) => ({
    id: c.id,
    label: `${c.package.name} • ${c.phase === "FUNDED" ? "Funded" : c.phase.replace("_", " ")}`,
    status: c.status,
    phase: c.phase,
    currentBalance: c.currentBalance,
  }));

  return <Terminal challenges={options} />;
}
