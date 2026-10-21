import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/challenges", label: "Challenges" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/kyc", label: "KYC" },
  { href: "/admin/tickets", label: "Tickets" },
  { href: "/admin/packages", label: "Packages" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/security", label: "Security" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  await requireAdmin();

  return (
    <>
      <SiteHeader />
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-300">
          Admin panel — actions here affect live accounts and money.
        </div>
        <div className="flex flex-col gap-8 lg:flex-row">
          <aside className="lg:w-52 lg:shrink-0">
            <nav className="flex flex-wrap gap-1.5 lg:flex-col">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
