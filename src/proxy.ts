import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get("session")?.value;

  const isDashboard = pathname.startsWith("/dashboard");
  const isAdmin = pathname.startsWith("/admin");

  // Presence-of-cookie gate only. Real validity (the DB session registry) is
  // enforced in the layouts via requireUser/requireAdmin. We must NOT bounce
  // /login -> /dashboard on cookie presence alone: a stale cookie (revoked or
  // expired session) would otherwise ping-pong forever between /login and
  // /dashboard — the proxy sees a cookie, the layout's DB check rejects it.
  // Logged-in users are redirected server-side in the auth pages instead,
  // using the same DB-validated check as everywhere else.
  if ((isDashboard || isAdmin) && !session) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }
  if (pathname === "/dashboard/trade") {
    const reqHeaders = new Headers(request.headers);
    reqHeaders.set("x-fullscreen", "1");
    return NextResponse.next({ request: { headers: reqHeaders } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
