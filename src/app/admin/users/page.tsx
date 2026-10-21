import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { TableWrap, Th, Td, Badge } from "@/components/ui";
import { dateTime } from "@/lib/utils";
import { RoleForm } from "@/components/role-form";

export default async function AdminUsersPage({
  searchParams,
}: PageProps<"/admin/users">) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp?.q as string) || "";

  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q } },
            { name: { contains: q } },
            { referralCode: { contains: q } },
          ],
        }
      : undefined,
    include: {
      _count: { select: { challenges: true, referrals: true } },
      kyc: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="mt-1 text-sm text-slate-400">
          {users.length} user(s) shown.
        </p>
      </div>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search email, name, referral code..."
          className="input max-w-md"
        />
        <button className="btn-secondary">Search</button>
      </form>

      <TableWrap>
        <thead>
          <tr className="border-b border-slate-800">
            <Th>Joined</Th>
            <Th>User</Th>
            <Th>Role</Th>
            <Th>Referral</Th>
            <Th>Referrals made</Th>
            <Th>Challenges</Th>
            <Th>KYC</Th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-slate-800/60">
              <Td className="whitespace-nowrap text-xs text-slate-400">
                {dateTime(u.createdAt)}
              </Td>
              <Td>
                <p className="text-sm">{u.name}</p>
                <p className="text-xs text-slate-500">{u.email}</p>
              </Td>
              <Td>
                <Badge color={u.role === "ADMIN" ? "violet" : "slate"}>
                  {u.role}
                </Badge>
                <div className="mt-1">
                  <RoleForm userId={u.id} currentRole={u.role} />
                </div>
              </Td>
              <Td className="font-mono text-xs">{u.referralCode}</Td>
              <Td>{u._count.referrals}</Td>
              <Td>{u._count.challenges}</Td>
              <Td>
                {u.kyc ? (
                  <Badge
                    color={
                      u.kyc.status === "APPROVED"
                        ? "emerald"
                        : u.kyc.status === "REJECTED"
                          ? "rose"
                          : "amber"
                    }
                  >
                    {u.kyc.status}
                  </Badge>
                ) : (
                  <span className="text-xs text-slate-500">—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
