"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Copy, Check, Loader2, FileUp, ClipboardPaste, Link2, ArrowRight } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import { readSheet, previewMapped, commitImport } from "@/lib/actions/import";
import { IMPORT_TEMPLATE, MAPPABLE_FIELDS, type ImportRow } from "@/lib/import-meta";
import { channelLabels, channelOrder } from "@/lib/labels";

type Employee = { id: string; name: string };
type Mode = "file" | "paste" | "sheet";
type Step = "source" | "map" | "preview";

const statusStyle: Record<ImportRow["status"], string> = {
  new: "bg-success/15 text-success",
  duplicate: "bg-warning/15 text-warning",
  exists: "bg-info/15 text-info",
  invalid: "bg-destructive/15 text-destructive",
};
const statusLabel: Record<ImportRow["status"], string> = {
  new: "جديد", duplicate: "مكرر", exists: "موجود", invalid: "غير صالح",
};

export function ImportDialog({ onClose, employees }: { onClose: () => void; employees: Employee[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("source");
  const [mode, setMode] = useState<Mode>("file");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [autoDetected, setAutoDetected] = useState<Set<number>>(new Set());
  const [previewRows, setPreviewRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [assignMode, setAssignMode] = useState("self");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [defaultChannel, setDefaultChannel] = useState("");

  const hasChannelColumn = Object.values(mapping).includes("channel");
  const channelReady = hasChannelColumn || !!defaultChannel;

  const newCount = previewRows.filter((r) => r.status === "new").length;
  const existsCount = previewRows.filter((r) => r.status === "exists").length;
  // الافتراضي: المطابق «الموجود» يُضاف كمكرر (الخادم يقرّر التخطّي وفق حارس ٤٨ ساعة/نفس الإعلان).
  // مع «تحديث الموجود» يُحدَّث بدل أن يُضاف، فلا يدخل عدّ الإضافة.
  const willAdd = updateExisting ? newCount : newCount + existsCount;
  const canCommit = channelReady && (willAdd > 0 || (updateExisting && existsCount > 0));

  // الحقول الإجبارية للمطابقة: الاسم (أو الأول+الأخير) + الجوال.
  const mappedFields = Object.values(mapping);
  const hasName = mappedFields.includes("name") || mappedFields.includes("firstName") || mappedFields.includes("lastName");
  const hasPhone = mappedFields.includes("phone");

  function read(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("mode", mode);
    startTransition(async () => {
      const res = await readSheet(fd);
      if (!res.ok) { setError(res.error ?? "صار خطأ"); return; }
      setHeaders(res.headers ?? []);
      setRawRows(res.rows ?? []);
      const init: Record<string, string> = {};
      const auto = new Set<number>();
      (res.suggested ?? []).forEach((f, i) => { init[i] = f || ""; if (f) auto.add(i); });
      setMapping(init);
      setAutoDetected(auto);
      setStep("map");
    });
  }

  function preview() {
    setError(null);
    startTransition(async () => {
      const res = await previewMapped(rawRows, mapping);
      if (!res.ok) { setError(res.error ?? "صار خطأ"); return; }
      setPreviewRows(res.rows ?? []);
      setStep("preview");
    });
  }

  function commit() {
    startTransition(async () => {
      const res = await commitImport(previewRows, assignMode, updateExisting, defaultChannel || undefined);
      if (res.ok) {
        const parts = [`تم استيراد ${toArabicDigits(res.created ?? 0)} عميل`];
        if ((res.updated ?? 0) > 0) parts.push(`وتحديث ${toArabicDigits(res.updated ?? 0)} موجود`);
        setResult(parts.join(" "));
        router.refresh(); setStep("source"); setPreviewRows([]);
      } else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">
            استيراد عملاء {step === "map" ? "· مطابقة الأعمدة" : step === "preview" ? "· معاينة" : ""}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="size-5" /></button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {result && step === "source" && <p className="mb-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{result}</p>}

        {/* الخطوة ١: المصدر */}
        {step === "source" && (
          <>
            {/* مصدر العملاء — إلزامي لكل الدفعة (أعلى كل تبويب) */}
            <div className="mb-4 space-y-1.5">
              <label className="text-xs font-medium text-foreground">مصدر العملاء *</label>
              <select
                value={defaultChannel}
                onChange={(e) => setDefaultChannel(e.target.value)}
                required
                className={`select-base ${!defaultChannel ? "border-gold/50" : ""}`}
              >
                <option value="" disabled>اختر المصدر…</option>
                {channelOrder.map((c) => <option key={c} value={c}>{channelLabels[c]}</option>)}
              </select>
              <p className="text-[0.7rem] text-muted-foreground">يُسجَّل لكل العملاء في هذه الدفعة.</p>
            </div>
            <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1">
              {([["file", "رفع ملف", FileUp], ["paste", "لصق", ClipboardPaste], ["sheet", "رابط الشيت", Link2]] as const).map(([v, label, Icon]) => (
                <button key={v} onClick={() => setMode(v)} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors ${mode === v ? "bg-card text-gold" : "text-muted-foreground hover:text-foreground"}`}>
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>أي أعمدة — بنطابقها بالخطوة الجاية.</span>
              <button onClick={() => { navigator.clipboard.writeText(IMPORT_TEMPLATE); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="flex items-center gap-1 text-gold">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} نسخ قالب الأعمدة
              </button>
            </div>
            <form onSubmit={read} className="space-y-3">
              {mode === "file" && <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-foreground" />}
              {mode === "paste" && <textarea name="text" required rows={5} dir="ltr" placeholder={"name,phone,...\nعبدالله,0551234567,..."} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />}
              {mode === "sheet" && <input name="sheetUrl" required dir="ltr" placeholder="رابط Google Sheet (عام)" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />}
              <button type="submit" disabled={pending || !defaultChannel} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {pending && <Loader2 className="size-4 animate-spin" />} {!defaultChannel ? "اختر المصدر أولاً" : "اقرأ الملف"}
              </button>
            </form>
          </>
        )}

        {/* الخطوة ٢: مطابقة الأعمدة */}
        {step === "map" && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="mb-3 rounded-xl border border-gold/30 bg-gold/5 px-3 py-2.5 text-sm">
              <span className="font-medium text-gold">تعرّفنا على الأعمدة تلقائيًا ({toArabicDigits(autoDetected.size)})</span>
              <span className="text-muted-foreground"> — هل هذه المطابقة صحيحة؟ عدّل أي عمود قبل المتابعة. «الاسم» و«الجوال» إجباريان.</span>
            </div>
            {(!hasName || !hasPhone) && (
              <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive">
                {!hasName && !hasPhone ? "لازم تطابق عمودي «الاسم» و«الجوال»."
                  : !hasName ? "لازم تطابق عمود «الاسم»."
                    : "لازم تطابق عمود «الجوال»."}
              </div>
            )}
            <div className="flex-1 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-right text-sm">
                <thead className="sticky top-0 bg-secondary text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">العمود في ملفك</th><th className="px-3 py-2 font-medium">يقابل في النظام</th></tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground">{h || `عمود ${toArabicDigits(i + 1)}`}<div className="text-xs text-muted-foreground/70" dir="ltr">{rawRows[0]?.[i] ?? ""}</div></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <select value={mapping[i] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value }))} className="select-base">
                            <option value="">تجاهل</option>
                            {MAPPABLE_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                          {autoDetected.has(i) && mapping[i] && <span className="shrink-0 rounded-full border border-[#22c55e] bg-[#22c55e]/15 px-2 py-0.5 text-[10px] text-[#22c55e]">تلقائي</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-between">
              <button onClick={() => setStep("source")} className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground">رجوع</button>
              <button onClick={preview} disabled={pending || !hasName || !hasPhone} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {pending && <Loader2 className="size-4 animate-spin" />} المطابقة صحيحة · متابعة <ArrowRight className="size-4 rotate-180" />
              </button>
            </div>
          </div>
        )}

        {/* الخطوة ٣: معاينة + استيراد */}
        {step === "preview" && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-right text-sm">
                <thead className="sticky top-0 bg-secondary text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">الاسم</th><th className="px-3 py-2 font-medium">الجوال</th><th className="px-3 py-2 font-medium">الحالة</th></tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground">{r.name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground" dir="ltr">{r.phone || "—"}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${statusStyle[r.status]}`}>{statusLabel[r.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              {/* مصدر العملاء — تأكيد (يُختار في الخطوة الأولى) */}
              {!hasChannelColumn ? (
                <p className="text-xs text-muted-foreground">
                  المصدر: <span className="font-medium text-gold">{defaultChannel ? channelLabels[defaultChannel as keyof typeof channelLabels] : "—"}</span> — لكل العملاء في هذه الدفعة.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">القناة تُقرأ من عمود في الملف.</p>
              )}
              {existsCount > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-info">
                    {toArabicDigits(existsCount)} رقم موجود مسبقًا — بيُضاف كنسخة مكرّرة ويظهر في «العملاء المكررون» (إلا نفس الإعلان خلال ٤٨ ساعة).
                  </p>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                    بدل إضافتهم كمكرر: حدّث القيم الفاضية للموجود ({toArabicDigits(existsCount)}) من بيانات الملف
                  </label>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button onClick={() => setStep("map")} className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground">رجوع للمطابقة</button>
                <div className="flex items-center gap-2">
                  <select value={assignMode} onChange={(e) => setAssignMode(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <option value="self">إسناد لي</option>
                    <option value="roundrobin">توزيع بالتساوي</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <button onClick={commit} disabled={pending || !canCommit} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                    {willAdd > 0 ? `استيراد (${toArabicDigits(willAdd)})` : `تحديث (${toArabicDigits(existsCount)})`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
