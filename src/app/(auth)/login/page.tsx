import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

/**
 * Server-side, DB-validated redirect for already-authenticated users. Kept off
 * the proxy on purpose so a stale session cookie can never loop here (see
 * proxy.ts) — the redirect only fires when a real, active session exists.
 */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
  return <LoginForm />;
}
