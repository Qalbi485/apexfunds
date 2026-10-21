import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { TableWrap, Th, Td, Badge } from "@/components/ui";
import { dateTime } from "@/lib/utils";

function parseJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function short(s: unknown): string {
  if (s === null || s === undefined) return "—";
  const str = typeof s === "string" ? s : JSON.stringify(s);
  return str.length > 120 ? `${str.slice(0, 120)}…` : str;
}

export default async function AdminAuditPage({
  searchParams,
}: PageProps<"/admin/audit">) {
  await requireAdmin();
  const sp = await searchParams;
  const action = typeof sp?.action === "string" ? sp.action : "";
  const outcome = typeof sp?.outcome === "string" ? sp.outcome : "";

  const rows = await db.auditLog.findMany({
    where: {
      ...(action ? { action: { contains: action } } : {}),
      ...(outcome ? { outcome } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const actions = await db.auditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Audit log</h1>
        <p className="mt-1 text-sm text-slate-400">
          Append-only financial and privileged-action trail (database-enforced;
          UPDATE/DELETE are blocked by triggers). Passwords, tokens, and KYC
          documents are never recorded.
        </p>
      </div>

      <form className="flex flex-wrap gap-2">
        <input
          name="action"
          defaultValue={action}
          placeholder="Filter action (e.g. PAYOUT_)"
          className="input max-w-xs"
        />
        <select name="outcome" defaultValue={outcome} className="input max-w-[140px]">
          <option value="">Any outcome</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="FAILURE">FAILURE</option>
        </select>
        <button className="btn-secondary">Filter</button>
        <datalist>
          {actions.map((a) => (
            <option key={a.action} value={a.action} />
          ))}
        </datalist>
      </form>

      {rows.length === 0 ? (
        <div className="card text-sm text-slate-400">No audit records yet.</div>
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-800">
              <Th>Time</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Outcome</Th>
              <Th>Before</Th>
              <Th>After</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-800/60">
                <Td className="whitespace-nowrap text-xs text-slate-400">
                  {dateTime(r.createdAt)}
                </Td>
                <Td className="text-xs">
                  <p className="text-slate-300">{r.actorEmail || r.actorId || "system"}</p>
                </Td>
                <Td className="font-mono text-xs">{r.action}</Td>
                <Td className="text-xs text-slate-400">
                  {r.entityType}
                  {r.entityId ? (
                    <span className="block font-mono text-[10px] text-slate-600">
                      {r.entityId.slice(0, 12)}…
                    </span>
                  ) : null}
                </Td>
                <Td>
                  <Badge color={r.outcome === "SUCCESS" ? "emerald" : "rose"}>
                    {r.outcome}
                  </Badge>
                </Td>
                <Td className="max-w-[180px] truncate font-mono text-[10px] text-slate-500">
                  {short(parseJson(r.beforeJson))}
                </Td>
                <Td className="max-w-[180px] truncate font-mono text-[10px] text-slate-500">
                  {short(parseJson(r.afterJson))}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
