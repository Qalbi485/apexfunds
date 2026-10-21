import { cn } from "@/lib/utils";

export function Badge({
  children,
  color = "slate",
}: {
  children: React.ReactNode;
  color?: "slate" | "emerald" | "amber" | "rose" | "cyan" | "violet";
}) {
  const colors: Record<string, string> = {
    slate: "bg-slate-800 text-slate-300 border-slate-700",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
    violet: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        colors[color]
      )}
    >
      {children}
    </span>
  );
}

export function statusBadge(status: string) {
  const map: Record<string, "slate" | "emerald" | "amber" | "rose" | "cyan" | "violet"> = {
    ACTIVE: "emerald",
    FUNDED: "cyan",
    PASSED: "emerald",
    FAILED: "rose",
    BREACHED: "rose",
    PENDING_PAYMENT: "amber",
    PENDING: "amber",
    CONFIRMED: "emerald",
    REQUESTED: "amber",
    APPROVED: "violet",
    PAID: "emerald",
    REJECTED: "rose",
    OPEN: "amber",
    REPLIED: "cyan",
    CLOSED: "slate",
  };
  const color = map[status] ?? "slate";
  return <Badge color={color}>{status.replace(/_/g, " ")}</Badge>;
}

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-100">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function ProgressBar({
  value,
  color = "emerald",
  label,
  right,
}: {
  value: number;
  color?: "emerald" | "amber" | "rose" | "cyan";
  label?: string;
  right?: string;
}) {
  const bar: Record<string, string> = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    cyan: "bg-cyan-500",
  };
  const v = Math.max(0, Math.min(100, value));
  return (
    <div>
      {(label || right) && (
        <div className="mb-1 flex justify-between text-xs text-slate-400">
          <span>{label}</span>
          <span>{right}</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={cn("h-full rounded-full transition-all", bar[color])}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center py-14 text-center">
      <p className="text-lg font-semibold text-slate-200">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-400">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-4 py-3 text-slate-200", className)}>{children}</td>;
}
