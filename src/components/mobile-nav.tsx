"use client";

import { useState } from "react";
import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth";

type NavItem = { href: string; label: string };

export function MobileNav({
  items,
  isLoggedIn,
  dashboardHref,
}: {
  items: readonly NavItem[];
  isLoggedIn: boolean;
  dashboardHref: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        {open ? (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M4.3 4.3a1 1 0 0 1 1.4 0L10 8.6l4.3-4.3a1 1 0 1 1 1.4 1.4L11.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 0 1-1.4-1.4L8.6 10 4.3 5.7a1 1 0 0 1 0-1.4z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M3 5h14a1 1 0 1 1 0 2H3a1 1 0 0 1 0-2zm0 4h14a1 1 0 1 1 0 2H3a1 1 0 0 1 0-2zm0 4h14a1 1 0 1 1 0 2H3a1 1 0 0 1 0-2z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>

      {open && (
        <div className="glass absolute inset-x-0 top-16 z-50 border-b border-white/[0.06] px-4 py-4 shadow-2xl sm:px-6">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            <div className="my-2 h-px bg-white/[0.08]" />
            {isLoggedIn ? (
              <>
                <Link
                  href={dashboardHref}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  Dashboard
                </Link>
                <form action={logoutAction} className="px-1 pt-1">
                  <button
                    type="submit"
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    Logout
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  onClick={() => setOpen(false)}
                  className="btn-primary mt-2"
                >
                  Get Started
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
