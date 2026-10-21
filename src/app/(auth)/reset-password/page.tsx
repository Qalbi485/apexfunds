import Link from "next/link";
import { ResetPasswordForm } from "@/components/reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const sp = await searchParams;
  const token = typeof sp?.token === "string" ? sp.token : "";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500 text-lg font-bold text-white">
            A
          </span>
          <span className="text-xl font-bold text-white">ApexFunds</span>
        </Link>
        <div className="card">
          <h1 className="text-2xl font-bold text-white">Choose a new password</h1>
          <p className="mt-1 text-sm text-slate-400">
            This link is single-use and expires 30 minutes after it was
            requested. All existing sessions will be signed out.
          </p>
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
              Missing or invalid reset link.{" "}
              <Link href="/forgot-password" className="underline">
                Request a new one
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
