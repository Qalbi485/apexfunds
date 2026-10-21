import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { SettingsForm } from "@/components/settings-form";

export default async function AdminSettingsPage() {
  await requireAdmin();
  const rows = await db.setting.findMany();
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Payment addresses and site configuration.
        </p>
      </div>

      <div className="card max-w-2xl">
        <h2 className="text-lg font-semibold text-white">
          Payment addresses
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          These addresses are shown to traders on the checkout page.
        </p>
        <SettingsForm settings={settings} />
      </div>

      <div className="card max-w-2xl">
        <h2 className="text-lg font-semibold text-white">
          Admin account note
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Default admin login: admin@apexfunds.com / Admin@12345 — change this
          password immediately from the database or by adding a change-password
          feature before going live.
        </p>
      </div>
    </div>
  );
}
