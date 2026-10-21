import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
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
          <h1 className="text-2xl font-bold text-white">Reset password</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter your account email. If it exists, we&apos;ll send a
            single-use link valid for 30 minutes.
          </p>
          <ForgotPasswordForm />
          <p className="mt-6 text-center text-sm text-slate-400">
            <Link href="/login" className="text-blue-400 hover:underline">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
