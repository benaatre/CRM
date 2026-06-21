import { requireManager } from "@/lib/auth-guards";
import { getAuditLog } from "@/lib/data/audit";
import { timeAgo, formatDate } from "@/lib/format";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

const actionColor: Record<string, string> = {
  "booking.created": "text-success",
  "booking.cancelled": "text-destructive",
  "booking.stage": "text-gold",
  "booking.finance": "text-warning",
  "lead.created": "text-info",
  "lead.reassigned": "text-muted-foreground",
};

export default async function AuditPage() {
  await requireManager();
  const entries = await getAuditLog();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AutoRefresh seconds={30} />
      <header>
        <h1 className="text-2xl font-bold text-foreground">سجل التدقيق</h1>
        <p className="mt-1 text-sm text-muted-foreground">كل عملية: من غيّر + متى + ماذا — يتحدّث تلقائيًا</p>
      </header>

      {entries.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">ما فيه عمليات مسجّلة بعد.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${(actionColor[e.action] ?? "text-muted-foreground").replace("text-", "bg-")}`} />
                <div>
                  <p className="text-sm text-foreground">{e.summary}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{e.userName ?? "النظام"}</p>
                </div>
              </div>
              <div className="shrink-0 text-left text-xs text-muted-foreground" title={formatDate(e.createdAt)}>{timeAgo(e.createdAt)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
