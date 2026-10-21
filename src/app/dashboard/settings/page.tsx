import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, statusBadge } from "@/components/ui";
import { KycForm } from "@/components/kyc-form";
import { PasswordForm } from "@/components/password-form";

export default async function SettingsPage() {
  const user = await requireUser();
  const kyc = await db.kyc.findUnique({ where: { userId: user.id } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Account details, KYC verification, and referral code.
        </p>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-white">Profile</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Name</dt>
            <dd className="mt-1 text-sm text-slate-200">{user.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Email</dt>
            <dd className="mt-1 text-sm text-slate-200">{user.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Your referral code</dt>
            <dd className="mt-1">
              <Badge color="cyan">{user.referralCode}</Badge>
              <p className="mt-1 text-xs text-slate-500">
                Share it — earn 10% commission on every purchase.
              </p>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Member since</dt>
            <dd className="mt-1 text-sm text-slate-200">
              {user.createdAt.toLocaleDateString()}
            </dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-white">Change password</h2>
        <PasswordForm />
      </div>

      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Identity verification (KYC)
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Required before your first payout.
            </p>
          </div>
          {kyc && statusBadge(kyc.status)}
        </div>
        {kyc?.status === "APPROVED" ? (
          <p className="mt-4 text-sm text-emerald-400">
            Your identity is verified. You are all set for payouts.
          </p>
        ) : (
          <KycForm />
        )}
      </div>
    </div>
  );
}
