import { requireAdmin, verifySession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Th } from "@/components/ui";
import {
  ReverifyForm,
  TotpSetup,
  SessionRow,
  RevokeOthersButton,
} from "@/components/admin-security";

export default async function AdminSecurityPage() {
  const admin = await requireAdmin();
  const session = await verifySession();

  const user = await db.user.findUnique({ where: { id: admin.id } });
  const sessions = await db.session.findMany({
    where: { userId: admin.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Security</h1>
        <p className="mt-1 text-sm text-slate-400">
          Two-factor authentication, step-up verification, and active sessions.
        </p>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-white">
          Step-up verification
        </h2>
        <ReverifyForm twoFactorEnabled={!!user?.totpEnabled} />
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-white">
          Two-factor authentication (TOTP)
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          When enabled (and the <code>adminTwoFactor</code> setting is on),
          sensitive admin actions require an authenticator code in addition to
          your password.
        </p>
        <TotpSetup enabled={!!user?.totpEnabled} pendingSetup={null} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Active sessions</h2>
          <RevokeOthersButton />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <Th>Created</Th>
                <Th>User agent</Th>
                <Th>Expires</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  jti={s.id}
                  isCurrent={s.id === session?.jti}
                  createdAt={s.createdAt.toISOString()}
                  expiresAt={s.expiresAt.toISOString()}
                  userAgent={s.userAgent || ""}
                />
              ))}
            </tbody>
          </table>
          {sessions.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">No active sessions.</p>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Password changes automatically revoke all other sessions.
        </p>
      </div>
    </div>
  );
}
