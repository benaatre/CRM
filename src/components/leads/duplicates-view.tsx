"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy } from "lucide-react";
import { formatDate, toArabicDigits } from "@/lib/format";
import { stageLabels, stageColor, followUpResultLabels, channelLabels } from "@/lib/labels";
import type { DuplicatesData, DupGroup, DupMember } from "@/lib/data/duplicates";
import { pullDuplicateLead, archiveDuplicateLead } from "@/lib/actions/leads";
import { FilterChip } from "./filter-chip";
import { DistributeDupButton } from "./distribute-dup-dialog";

type Employee = { id: string; name: string };
type RangeFilter = "all" | "today" | "week";

// نافذة «آخر ٧ أيام» — متدحرجة على lastAddedAt (فلترة عرض فقط، لا صلاحيات).
const DUP_WEEK_MS = 7 * 24 * 3_600_000;

/**
 * صفحة «العملاء المكررون» — جدول واحد بروح جدول العملاء الرئيسي:
 * صف رأس لكل مجموعة (الرقم + عدد التكرارات + شارات «جديد اليوم»/«مكرر مع محجوز!»)
 * ثم صفوف سجلاتها بأفعال مباشرة (توزيع بالوضعين / سحب / حذف=أرشفة كمكرر).
 */
export function DuplicatesView({ data, employees }: { data: DuplicatesData; employees: Employee[] }) {
  const [range, setRange] = useState<RangeFilter>("all");
  const weekCutoff = Date.now() - DUP_WEEK_MS;
  const shown = data.groups.filter((g) =>
    range === "all" ? true
      : range === "today" ? g.newToday
        : new Date(g.lastAddedAt).getTime() >= weekCutoff);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">العملاء المكررون</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            أرقام جوال مكرّرة بين سجلات حيّة — محجوبة عن التوزيع التلقائي حتى تُحلّ من هنا
          </p>
        </div>
        {/* العدّادان: إجمالي المجموعات + كم فيها جديد اليوم */}
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-medium text-gold">
            {toArabicDigits(data.totalGroups)} مجموعة
          </span>
          {data.newTodayGroups > 0 && (
            <span className="rounded-full border border-orange-500/30 bg-orange-500/15 px-3 py-1 font-medium text-orange-300">
              {toArabicDigits(data.newTodayGroups)} جديد اليوم
            </span>
          )}
        </div>
      </header>

      {/* الفلاتر الزمنية */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={range === "all"} onClick={() => setRange("all")}
          className={chip(range === "all")}>الكل ({toArabicDigits(data.totalGroups)})</FilterChip>
        <FilterChip active={range === "today"} onClick={() => setRange("today")}
          className={chip(range === "today")}>اليوم ({toArabicDigits(data.newTodayGroups)})</FilterChip>
        <FilterChip active={range === "week"} onClick={() => setRange("week")}
          className={chip(range === "week")}>آخر ٧ أيام</FilterChip>
      </div>

      {data.totalGroups === 0 ? (
        <p className="rounded-2xl border border-border bg-card py-12 text-center text-muted-foreground">
          ما فيه عملاء مكررون — كل رقم جوال في سجل حيّ واحد. 👌
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          ما فيه مجموعات ضمن هذا الفلتر.
        </p>
      ) : (
        <div className="scroll-x rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[1000px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">الاسم</th>
                <th className="px-3 py-3 font-medium">الجوال</th>
                <th className="px-3 py-3 font-medium">المصدر/الإعلان</th>
                <th className="px-3 py-3 font-medium">تاريخ الإضافة</th>
                <th className="px-3 py-3 font-medium">الموظف</th>
                <th className="px-3 py-3 font-medium">المرحلة</th>
                <th className="px-3 py-3 font-medium">آخر متابعة</th>
                <th className="px-3 py-3 font-medium">أفعال</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => <GroupRows key={g.key} group={g} employees={employees} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? "border-gold bg-gold/20 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`;
}

function GroupRows({ group, employees }: { group: DupGroup; employees: Employee[] }) {
  return (
    <>
      {/* صف رأس المجموعة */}
      <tr className={`border-t-2 ${group.hasReserved ? "border-destructive/40 bg-destructive/[0.07]" : "border-gold/25 bg-gold/[0.05]"}`}>
        <td colSpan={8} className="px-3 py-2.5">
          <span className="inline-flex flex-wrap items-center gap-2">
            {group.hasReserved
              ? <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
              : <Copy className="size-4 shrink-0 text-gold" aria-hidden />}
            <span className="font-bold text-foreground" dir="ltr">{group.phone}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
              مكرّر {toArabicDigits(group.duplicateCount)} مرات
            </span>
            {group.newToday && (
              <span className="rounded-full border border-orange-500/30 bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold text-orange-300">جديد اليوم</span>
            )}
            {/* ثغرة RESERVED: المحجوز الحيّ يحجب أخاه الجديد عن التوزيع بصمت — هنا يبان والقرار للمالك */}
            {group.hasReserved && (
              <span className="rounded-full border border-destructive/40 bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">
                مكرر مع محجوز! — محجوب عن التوزيع التلقائي، القرار لك يدويًا
              </span>
            )}
            <span className="text-xs text-muted-foreground">أول إضافة: {formatDate(group.firstAddedAt)}</span>
          </span>
        </td>
      </tr>
      {group.members.map((m) => (
        <MemberRow key={m.id} m={m} group={group} employees={employees} />
      ))}
    </>
  );
}

function MemberRow({ m, group, employees }: { m: DupMember; group: DupGroup; employees: Employee[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // «مكرر مع»: أقدم سجل آخر بالمجموعة (توضيح شارة «جديد اليوم»).
  const oldestOther = group.members.find((x) => x.id !== m.id);

  function run(confirmMsg: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (!window.confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "صار خطأ");
      router.refresh();
    });
  }

  return (
    <tr className="border-t border-border transition-colors hover:bg-secondary/40">
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5">
          <Link href={`/leads/${m.id}`} className="font-medium text-foreground hover:text-gold" title="فتح الملف">{m.name}</Link>
          {m.addedToday && (
            <span
              className="rounded-full border border-orange-500/30 bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-bold text-orange-300"
              title={oldestOther ? `مكرر مع: ${oldestOther.name} (${formatDate(oldestOther.createdAt)})` : undefined}
            >جديد اليوم</span>
          )}
        </span>
        {error && <div className="mt-1 text-[10px] text-destructive">{error}</div>}
      </td>
      <td className="px-3 py-2.5 text-gold" dir="ltr">{m.phone}</td>
      <td className="px-3 py-2.5">
        <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs text-gold">{channelLabels[m.channel]}</span>
        {m.sourceName && <span className="mr-1.5 text-xs text-muted-foreground">{m.sourceName}</span>}
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{formatDate(m.createdAt)}</td>
      <td className="px-3 py-2.5 text-foreground">{m.assignedToName ?? <span className="text-muted-foreground">غير موزّع</span>}</td>
      <td className="px-3 py-2.5">
        <span className={`rounded-full border px-2 py-0.5 text-xs ${stageColor[m.stage]}`}>{stageLabels[m.stage]}</span>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground">
        {m.lastFollowUp ? `${followUpResultLabels[m.lastFollowUp.result]} · ${formatDate(m.lastFollowUp.createdAt)}` : "—"}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <DistributeDupButton leadId={m.id} leadName={m.name} employees={employees} />
          {m.assignedToId && (
            <button
              disabled={pending}
              onClick={() => run(
                `تسحب «${m.name}» من ${m.assignedToName ?? "موظفه"}؟ يرجع «غير موزّع» فورًا.`,
                () => pullDuplicateLead(m.id),
              )}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50"
            >سحب</button>
          )}
          <button
            disabled={pending}
            onClick={() => run(
              `تحذف «${m.name}»؟ يُؤرشف بسبب «مكرر» (السجل والمتابعات محفوظة) — وأخوه الحيّ يفكّ حجبه تلقائيًا.`,
              () => archiveDuplicateLead(m.id),
            )}
            className="rounded-lg border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >حذف</button>
        </div>
      </td>
    </tr>
  );
}
