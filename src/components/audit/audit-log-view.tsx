"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Share2, UserMinus, Phone, Home, Archive, ShieldAlert, FileText,
  Undo2, Search, X, Eye, EyeOff, UserPlus, ArrowLeftRight, Bell,
} from "lucide-react";
import { toArabicDigits, formatDateTime } from "@/lib/format";
import type { AuditEntry, AuditNameMaps, AuditEmployeeStat } from "@/lib/data/audit";

/**
 * سجل التدقيق v2 — مركز مراقبة: بطاقات سطر واحد + درج تفاصيل + تجميع الدفعات
 * + عدّادات الموظفين + بحث باسم العميل. كل هذا طبقة عرض فقط — السجلات الخام كما هي.
 */

// cuid — نفس نمط الخادم (resolveAuditNames).
const CUID_RE = /\bc[a-z0-9]{24}\b/g;
const BATCH_RE = /\[batch=([0-9a-f-]+)\]/i;

type ActionMeta = { label: string; icon: React.ComponentType<{ className?: string }>; color: string };

// خريطة الفعل → تسمية عربية + أيقونة + لون. غير المعروف يقع على fallback نصي.
const ACTION_META: Record<string, ActionMeta> = {
  "lead.created": { label: "أضاف عميلًا", icon: UserPlus, color: "text-info" },
  "lead.reassigned": { label: "أعاد إسناد عميل", icon: ArrowLeftRight, color: "text-gold" },
  "lead.transferred": { label: "حوّل عملاء", icon: ArrowLeftRight, color: "text-gold" },
  "lead.recovered": { label: "استرد عملاء للنظام", icon: Undo2, color: "text-muted-foreground" },
  "lead.distributed": { label: "وزّع مكررًا", icon: Share2, color: "text-gold" },
  "lead.no_response.distributed": { label: "وزّع من حوض «لم يتم الرد»", icon: Share2, color: "text-gold" },
  "lead.no_response.autoDistributed": { label: "وزّع الحوض تلقائيًا", icon: Share2, color: "text-gold" },
  "lead.no_response.manualPulled": { label: "سحب عميلًا يدويًا", icon: UserMinus, color: "text-destructive" },
  "lead.no_response.autoPulled": { label: "سُحب عميل تلقائيًا", icon: UserMinus, color: "text-destructive" },
  "lead.no_response.manualPullBatch": { label: "دورة سحب يدوي", icon: UserMinus, color: "text-destructive" },
  "lead.no_response.autoPullBatch": { label: "دورة سحب تلقائي", icon: UserMinus, color: "text-destructive" },
  "lead.no_response.undoPull": { label: "تراجع عن سحب", icon: Undo2, color: "text-success" },
  "lead.no_response.undoPullBatch": { label: "تراجع عن دفعة سحب", icon: Undo2, color: "text-success" },
  "lead.no_response.warned": { label: "أرسل إنذار متابعة", icon: Bell, color: "text-warning" },
  "lead.no_response.warnedAll": { label: "أرسل إنذارات للجميع", icon: Bell, color: "text-warning" },
  "followup.added": { label: "سجّل متابعة", icon: Phone, color: "text-success" },
  "lead.firstStage": { label: "حدّد أول تواصل", icon: Phone, color: "text-info" },
  "lead.stage": { label: "نقل مرحلة", icon: ArrowLeftRight, color: "text-muted-foreground" },
  "booking.created": { label: "أنشأ حجزًا", icon: Home, color: "text-success" },
  "booking.cancelled": { label: "ألغى حجزًا", icon: Home, color: "text-destructive" },
  "booking.stage": { label: "حرّك مرحلة حجز", icon: Home, color: "text-gold" },
  "booking.finance": { label: "حدّث تمويل حجز", icon: Home, color: "text-warning" },
  "lead.archived": { label: "أرشف عملاء", icon: Archive, color: "text-muted-foreground" },
  "lead.unarchived": { label: "أرجع من الأرشيف", icon: Archive, color: "text-info" },
  "lead.deleted": { label: "حذف عملاء نهائيًا", icon: ShieldAlert, color: "text-destructive" },
  REVEAL_HISTORY: { label: "كشف سجل المتابعات", icon: Eye, color: "text-warning" },
  HIDE_HISTORY: { label: "أخفى سجل المتابعات", icon: EyeOff, color: "text-warning" },
  "user.securityChange": { label: "تغيير أمني (دور/رمز)", icon: ShieldAlert, color: "text-destructive" },
};

const FALLBACK_META: ActionMeta = { label: "", icon: FileText, color: "text-muted-foreground" };
const metaFor = (action: string): ActionMeta => ACTION_META[action] ?? FALLBACK_META;

// سبب السحب بالعربي من نص الملخص.
function pullReason(summary: string): string | null {
  if (summary.includes("no_response_exhausted")) return "استنفاد محاولات (تابع وما رد)";
  if (summary.includes("no_response_neglect")) return "تقصير (انتهت المهلة بلا متابعة)";
  return null;
}

/** يستبدل معرّفات cuid في النص بأسماء قابلة للنقر (عميل) أو أسماء خام (موظف). */
function Linkified({ text, names }: { text: string; names: AuditNameMaps }) {
  const parts = useMemo(() => {
    const out: (string | { id: string })[] = [];
    let last = 0;
    for (const m of text.matchAll(CUID_RE)) {
      if (m.index! > last) out.push(text.slice(last, m.index));
      out.push({ id: m[0] });
      last = m.index! + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text]);

  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === "string") return <span key={i}>{p}</span>;
        const lead = names.leadNames[p.id];
        if (lead) {
          return (
            <Link key={i} href={`/leads/${p.id}`} target="_blank" className="font-medium text-gold underline-offset-2 hover:underline">
              {lead}
            </Link>
          );
        }
        const user = names.userNames[p.id];
        if (user) return <span key={i} className="font-medium text-foreground">{user}</span>;
        return <span key={i} className="text-muted-foreground/60">عميل محذوف</span>;
      })}
    </>
  );
}

// ===================== التجميع الذكي (طبقة عرض فقط) =====================

type Group = {
  key: string;
  action: string;
  userName: string | null;
  batchId: string | null;
  entries: AuditEntry[];
  newest: Date;
};

/** يدمج السجلات المتتالية بنفس batchId، أو نفس (النوع+الفاعل) خلال دقيقة واحدة. */
function groupEntries(entries: AuditEntry[]): Group[] {
  const groups: Group[] = [];
  for (const e of entries) {
    const batch = BATCH_RE.exec(e.summary)?.[1] ?? null;
    const prev = groups[groups.length - 1];
    const sameBatch = prev && batch && prev.batchId === batch;
    const sameBurst = prev && !batch && !prev.batchId && prev.action === e.action && prev.userName === e.userName
      && Math.abs(prev.newest.getTime() - e.createdAt.getTime()) <= 60_000;
    if (sameBatch || sameBurst) {
      prev.entries.push(e);
      continue;
    }
    groups.push({ key: e.id, action: e.action, userName: e.userName, batchId: batch, entries: [e], newest: e.createdAt });
  }
  return groups;
}

// ===================== المكوّن الرئيسي =====================

export function AuditLogView({
  entries, names, stats, currentEmp, when,
}: {
  entries: AuditEntry[];
  names: AuditNameMaps;
  stats: AuditEmployeeStat[];
  currentEmp: string;
  /** دالة عرض الوقت جاهزة من الخادم لكل سجل (اليوم/أمس/تاريخ كامل). */
  when: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Group | null>(null);
  const [q, setQ] = useState("");

  // بحث باسم العميل ضمن السجلات المعروضة: نطابق على النص بعد حلّ الأسماء.
  const visible = useMemo(() => {
    const term = q.trim();
    if (!term) return entries;
    return entries.filter((e) => {
      let resolved = e.summary;
      for (const m of e.summary.matchAll(CUID_RE)) {
        resolved += ` ${names.leadNames[m[0]] ?? ""} ${names.userNames[m[0]] ?? ""}`;
      }
      return resolved.includes(term) || (e.userName ?? "").includes(term);
    });
  }, [entries, q, names]);

  const groups = useMemo(() => groupEntries(visible), [visible]);

  function toggleEmp(id: string) {
    const p = new URLSearchParams(window.location.search);
    if (p.get("emp") === id) p.delete("emp");
    else p.set("emp", id);
    router.push(`/audit?${p.toString()}`);
  }

  return (
    <div className="space-y-4">
      {/* ===== عدّادات الموظفين ضمن الفترة (الأنشط أولًا) ===== */}
      {stats.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {stats.map((s) => (
            <button
              key={s.id}
              onClick={() => toggleEmp(s.id)}
              className={`min-w-44 shrink-0 rounded-2xl border p-3 text-right transition-colors ${currentEmp === s.id ? "border-gold bg-gold/10" : "border-border bg-card hover:border-gold/40"}`}
              title="اضغط لفلترة السجلات على هذا الموظف"
            >
              <div className="mb-1.5 text-sm font-bold text-foreground">{s.name}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>اتصالات: <b className="text-foreground">{toArabicDigits(s.calls)}</b></span>
                <span>متابعات: <b className="text-foreground">{toArabicDigits(s.followups)}</b></span>
                <span>زيارات: <b className="text-foreground">{toArabicDigits(s.visits)}</b></span>
                <span>حجوزات: <b className="text-success">{toArabicDigits(s.bookings)}</b></span>
                <span>استقبل: <b className="text-gold">{toArabicDigits(s.received)}</b></span>
                <span>سُحب منه: <b className="text-destructive">{toArabicDigits(s.pulled)}</b></span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ===== بحث باسم العميل ===== */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث باسم العميل أو الموظف ضمن السجلات المعروضة…"
          className="w-full rounded-xl border border-border bg-card py-2.5 pr-9 pl-3 text-sm outline-none focus:border-gold"
        />
      </div>

      {/* ===== البطاقات (مجمّعة) ===== */}
      {groups.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">ما فيه عمليات مطابقة.</p>
      ) : (
        <ol className="space-y-2">
          {groups.map((g) => {
            const meta = metaFor(g.action);
            const Icon = meta.icon;
            const first = g.entries[0];
            const count = g.entries.length;
            return (
              <li key={g.key}>
                <button
                  onClick={() => setOpen(g)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-right transition-colors hover:border-gold/40"
                >
                  <Icon className={`size-4 shrink-0 ${meta.color}`} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    <b>{g.userName ?? "النظام"}</b>
                    {" — "}
                    {meta.label ? (
                      <>
                        {meta.label}
                        {count > 1 && <span className="mx-1 rounded-full bg-secondary px-1.5 py-0.5 text-xs font-bold text-gold">×{toArabicDigits(count)}</span>}
                        {count === 1 && (
                          <span className="text-muted-foreground"> · <Linkified text={shortTarget(first.summary)} names={names} /></span>
                        )}
                      </>
                    ) : (
                      <Linkified text={first.summary} names={names} />
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{when[first.id]}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {/* ===== درج التفاصيل ===== */}
      {open && <AuditDrawer group={open} names={names} when={when} onClose={() => setOpen(null)} />}
    </div>
  );
}

// اختصار الهدف لسطر البطاقة: أول ١٢٠ حرفًا من الملخص (بلا [batch=…]).
function shortTarget(summary: string): string {
  const s = summary.replace(BATCH_RE, "").trim();
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

function AuditDrawer({ group, names, when, onClose }: {
  group: Group; names: AuditNameMaps; when: Record<string, string>; onClose: () => void;
}) {
  const meta = metaFor(group.action);
  const Icon = meta.icon;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col border-r border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Icon className={`size-4 ${meta.color}`} />
            {meta.label || "تفاصيل العملية"}
            {group.entries.length > 1 && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold">×{toArabicDigits(group.entries.length)}</span>}
          </h2>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="size-4" /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="rounded-xl border border-border bg-background/50 p-3 text-xs text-muted-foreground">
            <div>الفاعل: <b className="text-foreground">{group.userName ?? "النظام"}</b></div>
            {group.batchId && <div className="mt-0.5">الدفعة: <span dir="ltr" className="font-mono text-[10px]">{group.batchId}</span></div>}
            <div className="mt-0.5">الوقت: {when[group.entries[0].id]}{group.entries.length > 1 ? ` — ${formatDateTime(group.entries[group.entries.length - 1].createdAt)}` : ""}</div>
            {pullReason(group.entries.map((e) => e.summary).join(" ")) && (
              <div className="mt-0.5">سبب السحب: <b className="text-destructive">{pullReason(group.entries.map((e) => e.summary).join(" "))}</b></div>
            )}
          </div>

          <ol className="space-y-2">
            {group.entries.map((e) => (
              <li key={e.id} className="rounded-xl border border-border p-3 text-sm leading-6 text-foreground">
                <Linkified text={e.summary} names={names} />
                <div className="mt-1 text-[11px] text-muted-foreground">{when[e.id]}</div>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </>
  );
}
