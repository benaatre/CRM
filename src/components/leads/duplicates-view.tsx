import Link from "next/link";
import { AlertTriangle, Copy } from "lucide-react";
import { formatDate, toArabicDigits } from "@/lib/format";
import { stageLabels, followUpResultLabels, channelLabels } from "@/lib/labels";
import type { DuplicatesData, DupGroup } from "@/lib/data/duplicates";
import { DistributeDupButton } from "./distribute-dup-dialog";

type Employee = { id: string; name: string };

export function DuplicatesView({ data, employees }: { data: DuplicatesData; employees: Employee[] }) {
  const empty = data.active.length === 0 && data.booked.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-foreground">العملاء المكررون</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          أرقام جوال مكرّرة في أكثر من سجل — للمراجعة والتوزيع
        </p>
      </header>

      {empty ? (
        <p className="rounded-2xl border border-border bg-card py-12 text-center text-muted-foreground">
          ما فيه عملاء مكررون — كل رقم جوال في سجل واحد.
        </p>
      ) : (
        <>
          {/* تنبيه: مكرر لعميل محجوز/مباع */}
          {data.booked.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-destructive" />
                <h2 className="text-lg font-bold text-destructive">مكرر لعميل محجوز / مباع</h2>
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
                  {toArabicDigits(data.booked.length)}
                </span>
              </div>
              <p className="text-xs text-destructive/80">هذا العميل حجز أو اشترى — انتبه قبل التوزيع.</p>
              {data.booked.map((g) => <GroupCard key={g.phone} group={g} employees={employees} warn />)}
            </section>
          )}

          {/* مكررون نشطون */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Copy className="size-5 text-gold" />
              <h2 className="text-lg font-bold text-foreground">مكررون نشطون</h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {toArabicDigits(data.active.length)}
              </span>
            </div>
            {data.active.length === 0 ? (
              <p className="rounded-xl border border-border bg-card py-8 text-center text-sm text-muted-foreground">
                ما فيه مكررون نشطون.
              </p>
            ) : (
              data.active.map((g) => <GroupCard key={g.phone} group={g} employees={employees} />)
            )}
          </section>
        </>
      )}
    </div>
  );
}

function GroupCard({ group, employees, warn }: { group: DupGroup; employees: Employee[]; warn?: boolean }) {
  const name = group.members[0]?.name ?? "—";
  return (
    <article className={`overflow-hidden rounded-2xl border ${warn ? "border-destructive/40 bg-destructive/[0.06]" : "border-border bg-card"}`}>
      {/* رأس مضغوط في سطر */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <span className="font-bold text-foreground">{name}</span>
        <span className="text-sm text-gold" dir="ltr">{group.phone}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">مكرّر {toArabicDigits(group.duplicateCount)} مرات</span>
        <span className="text-xs text-muted-foreground">أول إضافة: {formatDate(group.firstAddedAt)}</span>
      </div>

      {/* جدول السجلات المكررة */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">الإعلان/المصدر</th>
              <th className="px-3 py-2 font-medium">تاريخ الإضافة</th>
              <th className="px-3 py-2 font-medium">الموظف</th>
              <th className="px-3 py-2 font-medium">المرحلة</th>
              <th className="px-3 py-2 font-medium">آخر متابعة</th>
              <th className="px-3 py-2 font-medium">توزيع</th>
            </tr>
          </thead>
          <tbody>
            {group.members.map((m, i) => {
              const last = m.followups[m.followups.length - 1];
              return (
                <tr key={m.id} className="border-t border-border transition-colors hover:bg-secondary/40">
                  <td className="px-3 py-2">
                    <Link href={`/leads/${m.id}`} className="text-muted-foreground hover:text-gold" title="فتح الملف">{toArabicDigits(i + 1)}</Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs text-gold">{channelLabels[m.channel]}</span>
                    {m.sourceName && <span className="mr-1.5 text-xs text-muted-foreground">{m.sourceName}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(m.createdAt)}</td>
                  <td className="px-3 py-2 text-foreground">{m.assignedToName ?? "غير موزّع"}</td>
                  <td className="px-3 py-2"><span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{stageLabels[m.stage]}</span></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {last ? `${followUpResultLabels[last.result]} · ${formatDate(last.createdAt)}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <DistributeDupButton leadId={m.id} leadName={m.name} employees={employees} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}
