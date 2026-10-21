import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { statusBadge, TableWrap, Th, Td } from "@/components/ui";
import { money, dateTime } from "@/lib/utils";

export default async function AdminChallengesPage({
  searchParams,
}: PageProps<"/admin/challenges">) {
  await requireAdmin();
  const sp = await searchParams;
  const status = (sp?.status as string) || "";

  const challenges = await db.challenge.findMany({
    where: status ? { status } : undefined,
    include: {
      user: { select: { email: true, name: true } },
      package: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const filters = [
    { v: "", l: "All" },
    { v: "ACTIVE", l: "Active" },
    { v: "FUNDED", l: "Funded" },
    { v: "PENDING_PAYMENT", l: "Pending" },
    { v: "FAILED", l: "Failed" },
    { v: "BREACHED", l: "Breached" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Challenges</h1>
        <p className="mt-1 text-sm text-slate-400">
          {challenges.length} challenge(s).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.v}
            href={f.v ? `/admin/challenges?status=${f.v}` : "/admin/challenges"}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              status === f.v
                ? "bg-blue-500 text-white"
                : "border border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {f.l}
          </Link>
        ))}
      </div>

      <TableWrap>
        <thead>
          <tr className="border-b border-slate-800">
            <Th>Updated</Th>
            <Th>Trader</Th>
            <Th>Package</Th>
            <Th>Phase</Th>
            <Th>Balance</Th>
            <Th>Status</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {challenges.map((c) => (
            <tr key={c.id} className="border-b border-slate-800/60">
              <Td className="whitespace-nowrap text-xs text-slate-400">
                {dateTime(c.updatedAt)}
              </Td>
              <Td>
                <p className="text-sm">{c.user.name}</p>
                <p className="text-xs text-slate-500">{c.user.email}</p>
              </Td>
              <Td>{c.package.name}</Td>
              <Td className="text-xs">{c.phase.replace("_", " ")}</Td>
              <Td className="font-mono">
                {money(c.currentBalance)}
                <span className="text-xs text-slate-500">
                  {" "}
                  / {money(c.startBalance)}
                </span>
              </Td>
              <Td>{statusBadge(c.status)}</Td>
              <Td>
                <Link
                  href={`/admin/challenges/${c.id}`}
                  className="text-sm text-blue-400 hover:underline"
                >
                  View →
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
