import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { RegisterForm } from "./register-form";

/**
 * Server-side, DB-validated redirect for already-authenticated users (kept off
 * the proxy so a stale cookie can't loop; see proxy.ts).
 */
export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
  return <RegisterForm />;
}
