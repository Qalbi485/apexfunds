import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, TableWrap, Th, Td } from "@/components/ui";
import { money } from "@/lib/utils";
import { togglePackageAction } from "@/lib/actions/admin";
import { ActionButton } from "@/components/action-button";

export default async function AdminPackagesPage() {
  await requireAdmin();
  const packages = await db.package.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { challenges: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Packages</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enable/disable challenge packages shown on the landing page.
        </p>
      </div>

      <TableWrap>
        <thead>
          <tr className="border-b border-slate-800">
            <Th>Package</Th>
            <Th>Size</Th>
            <Th>Price</Th>
            <Th>Used by</Th>
            <Th>Rules</Th>
            <Th>Active</Th>
            <Th>Action</Th>
          </tr>
        </thead>
        <tbody>
          {packages.map((p) => {
            const phases = JSON.parse(p.phasesJson) as Array<{
              phase: string;
              targetPct: number;
              maxDailyLossPct: number;
              maxTotalDrawdownPct: number;
              minTradingDays: number;
            }>;
            return (
              <tr key={p.id} className="border-b border-slate-800/60">
                <Td className="font-medium">{p.name}</Td>
                <Td className="font-mono">
                  ${p.accountSize.toLocaleString()}
                </Td>
                <Td className="font-mono">{money(p.price)}</Td>
                <Td>{p._count.challenges}</Td>
                <Td className="text-xs text-slate-400">
                  {phases
                    .map(
                      (f) =>
                        `${f.phase}: ${f.targetPct}%/${
                          f.maxDailyLossPct
                        }%DD/${f.minTradingDays}d`
                    )
                    .join(" • ")}
                </Td>
                <Td>
                  {p.active ? (
                    <Badge color="emerald">ACTIVE</Badge>
                  ) : (
                    <Badge color="slate">DISABLED</Badge>
                  )}
                </Td>
                <Td>
                  <ActionButton
                    action={togglePackageAction.bind(null, p.id)}
                    label={p.active ? "Disable" : "Enable"}
                    variant={p.active ? "danger" : "primary"}
                    pendingLabel="..."
                  />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </div>
  );
}
