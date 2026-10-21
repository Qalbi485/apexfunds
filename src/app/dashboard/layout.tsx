import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/trade", label: "Trade" },
  { href: "/dashboard/payouts", label: "Payouts" },
  { href: "/dashboard/affiliate", label: "Affiliate" },
  { href: "/dashboard/support", label: "Support" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const h = await headers();
  if (h.get("x-fullscreen") === "1") {
    return <div className="h-screen overflow-hidden">{children}</div>;
  }

  const user = await requireUser();
  const unread = await db.notification.count({
    where: { userId: user.id, read: false },
  });

  return (
    <>
      <SiteHeader />
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row">
          <aside className="lg:w-56 lg:shrink-0">
            <nav className="flex flex-wrap gap-2 lg:flex-col">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60 hover:text-white"
                >
                  {item.label}
                  {item.href === "/dashboard" && unread > 0 && (
                    <span className="ml-2 rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {unread}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
            <div className="mt-6 hidden rounded-xl border border-slate-800 bg-slate-900/40 p-4 lg:block">
              <p className="text-xs text-slate-500">Logged in as</p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-200">
                {user.name}
              </p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
