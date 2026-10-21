import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { SITE } from "@/lib/config";
import { logoutAction } from "@/lib/actions/auth";
import { MobileNav } from "@/components/mobile-nav";

const NAV = [
  { href: "/#challenges", label: "Challenges" },
  { href: "/#how", label: "How it works" },
  { href: "/#payouts", label: "Payouts" },
  { href: "/#rules", label: "Rules" },
  { href: "/#faq", label: "FAQ" },
] as const;

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box =
    size === "lg"
      ? "h-11 w-11 rounded-xl text-lg"
      : size === "sm"
        ? "h-7 w-7 rounded-lg text-sm"
        : "h-9 w-9 rounded-xl text-base";
  const text = size === "lg" ? "text-xl" : "text-base";
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`flex items-center justify-center font-black text-white ${box}`}
        style={{
          background: "linear-gradient(135deg, #60a5fa, #3b82f6)",
          boxShadow: "0 8px 20px -8px rgba(59,130,246,0.8)",
        }}
        aria-hidden
      >
        A
      </span>
      <span className={`font-bold tracking-tight text-white ${text}`}>
        {SITE.name}
      </span>
    </span>
  );
}

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-50">
      <div className="glass border-b border-white/[0.06]">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="shrink-0" aria-label={`${SITE.name} home`}>
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <Link
                  href={user.role === "ADMIN" ? "/admin" : "/dashboard"}
                  className="btn-primary"
                >
                  Dashboard
                </Link>
                <form action={logoutAction} className="hidden sm:block">
                  <button className="btn-ghost text-sm">Logout</button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" className="btn-ghost hidden sm:inline-flex">
                  Log in
                </Link>
                <Link href="/register" className="btn-primary">
                  Get Started
                </Link>
              </>
            )}
            <MobileNav
              items={NAV}
              isLoggedIn={!!user}
              dashboardHref={user?.role === "ADMIN" ? "/admin" : "/dashboard"}
            />
          </div>
        </div>
      </div>
      {/* thin gradient hairline under header */}
      <div
        className="h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(59,130,246,0.6), rgba(34,211,238,0.4), transparent)",
        }}
        aria-hidden
      />
    </header>
  );
}

const FOOTER_COLS = [
  {
    title: "Product",
    links: [
      { href: "/#challenges", label: "Challenges" },
      { href: "/#how", label: "How it works" },
      { href: "/#payouts", label: "Payouts" },
      { href: "/#rules", label: "Trading rules" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/refund", label: "Refund Policy" },
      { href: "/legal/agreement", label: "Trader Agreement" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="relative mt-auto border-t border-white/[0.06] bg-[#04060a]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(59,130,246,0.45), transparent)",
        }}
        aria-hidden
      />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
            {SITE.description}
          </p>
          <div className="mt-5 flex items-center gap-2 text-xs text-slate-500">
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              aria-hidden
            />
            Payouts via USDT — TRC-20 / ERC-20
          </div>
        </div>
        {FOOTER_COLS.map((col) => (
          <div key={col.title}>
            <p className="text-sm font-semibold text-white">{col.title}</p>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition-colors hover:text-blue-300"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className="text-sm font-semibold text-white">Support</p>
          <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
            <li>
              <a
                href={`mailto:${SITE.supportEmail}`}
                className="transition-colors hover:text-blue-300"
              >
                {SITE.supportEmail}
              </a>
            </li>
            <li>Telegram: {SITE.telegram}</li>
            <li>24/7 for funded traders</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <p className="text-xs leading-relaxed text-slate-500">
            <span className="font-semibold text-slate-400">Risk warning:</span>{" "}
            Trading involves substantial risk and may not be suitable for every
            investor. Past performance is not indicative of future results. ©{" "}
            {new Date().getFullYear()} {SITE.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
