"use client";

// شاشة «مصادر العملاء» (الإعدادات — مالك فقط): مصدر لكل شيت (سناب/تيك توك/ميتا/جوجل…)
// بمؤشر تقدّم مستقل — إضافة/تفعيل/إيقاف + «جرّب الاتصال» (يقرأ أول صفّين) +
// آخر مزامنة · عملاء اليوم · آخر خطأ لكل مصدر. فشل مصدر لا يوقف البقية.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet, PlugZap, Trash2 } from "lucide-react";
import { channelLabels } from "@/lib/labels";
import { formatDateTime, toArabicDigits } from "@/lib/format";
import type { SheetSourcePanelRow } from "@/lib/data/sources";
import { addSheetSource, testSheetConnection, toggleSheetLink, deleteSheetLink, approveFullSync, startSyncFromNow, startSyncLastTwoDays, type SheetTestResult } from "@/lib/actions/sources";

// أسماء مقترحة (القناة تُشتق من الاسم تلقائيًا — سناب → سناب شات… إلخ).
const SUGGESTED = ["سناب شات", "تيك توك", "ميتا", "جوجل", "عقار"];

export function SheetSourcesPanel({ rows }: { rows: SheetSourcePanelRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [gid, setGid] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<{ forUrl: string; res: SheetTestResult } | null>(null);
  // «آخر يومين ثم لايف» بلا عمود تاريخ: سؤال «كم صفًا أخيرًا؟» لكل رابط + قيمة الحقل.
  const [askCountFor, setAskCountFor] = useState<{ linkId: string; totalRows: number } | null>(null);
  const [lastCount, setLastCount] = useState("");

  function runLastTwoDays(linkId: string, count?: number) {
    setMsg(null);
    startTransition(async () => {
      const r = await startSyncLastTwoDays(linkId, count);
      if (!r.ok && r.needCount) {
        setAskCountFor({ linkId, totalRows: r.totalRows ?? 0 });
        setLastCount("");
        return;
      }
      setAskCountFor(null);
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "تم") : (r.error ?? "صار خطأ") });
      router.refresh();
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "تم") : (r.error ?? "صار خطأ") });
      router.refresh();
    });
  }

  function doTest(sheetUrl: string, gidInput?: string) {
    setTest(null);
    setMsg(null);
    startTransition(async () => {
      const res = await testSheetConnection(sheetUrl, gidInput);
      setTest({ forUrl: sheetUrl, res });
    });
  }

  return (
    <section className="glass space-y-4 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-foreground"><Sheet className="size-4 text-gold" /> مصادر العملاء (جوجل شيت)</h2>
        <span className="text-xs text-muted-foreground">القراءة بمؤشر تقدّم — كل دورة تكمل من آخر صف</span>
      </div>

      {/* إضافة مصدر */}
      <div className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((s) => (
            <button key={s} type="button" onClick={() => setName(s)} className={`rounded-full border px-2.5 py-1 text-xs ${name === s ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"}`}>{s}</button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم المصدر…" className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold sm:w-40" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="رابط جوجل شيت…" dir="ltr" className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
          <input value={gid} onChange={(e) => setGid(e.target.value.replace(/\D/g, ""))} placeholder="رقم الورقة (gid)" dir="ltr" inputMode="numeric" className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold sm:w-36" />
          <div className="flex gap-2">
            <button type="button" disabled={pending || !url.trim()} onClick={() => doTest(url, gid)} className="flex items-center gap-1 rounded-lg border border-info/50 bg-info/10 px-3 py-2 text-xs font-medium text-info hover:bg-info/20 disabled:opacity-40"><PlugZap className="size-3.5" /> جرّب الاتصال</button>
            <button type="button" disabled={pending || !name.trim() || !url.trim()} onClick={() => run(async () => { const r = await addSheetSource(name, url, gid); if (r.ok) { setName(""); setUrl(""); setGid(""); } return r; })} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">إضافة المصدر</button>
          </div>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          تحديد الورقة إلزامي: افتح الورقة المطلوبة (مثل CRM) في المتصفح وانسخ الرقم بعد ‎gid=‎ من شريط العنوان — أو الصق رابطًا يحويه. بدون تحديد، ما تُضاف المزامنة (حماية من قراءة المستند كله).
        </p>
      </div>

      {/* نتيجة «جرّب الاتصال» — اسم الورقة + عدد الصفوف + أول الصفوف (يتأكد المالك أنها الورقة الصح) */}
      {test && (
        <div className={`rounded-xl border p-3 text-xs ${test.res.ok ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"}`}>
          {test.res.ok ? (
            <>
              <div className="mb-2 font-medium text-success">
                الاتصال شغال — الورقة: <span className="rounded bg-success/15 px-1.5 py-0.5 font-bold">«{test.res.tabTitle}»</span>
                <span className="mr-2 text-muted-foreground">عدد الصفوف الكلي: <span className="font-bold text-foreground">{toArabicDigits(test.res.totalRows ?? 0)}</span> — تأكد أنها الورقة الصح قبل الإضافة</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <tbody>
                    {test.res.rows!.map((r, i) => (
                      <tr key={i} className={i === 0 ? "text-muted-foreground" : "text-foreground"}>
                        {r.map((c, j) => <td key={j} className="whitespace-nowrap border border-border px-2 py-1">{c || "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <span className="text-destructive">فشل الاتصال: {test.res.error} — تأكد أن الشيت مُشارك مع إيميل حساب الخدمة.</span>
          )}
        </div>
      )}

      {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>{msg.text}</p>}

      {/* قائمة المصادر */}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">ما فيه مصادر بعد — أضف أول شيت فوق.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-right text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">المصدر</th>
                <th className="px-3 py-3 font-medium">القناة</th>
                <th className="px-3 py-3 text-center font-medium">عملاء اليوم</th>
                <th className="px-3 py-3 text-center font-medium">المؤشر</th>
                <th className="px-3 py-3 font-medium">آخر مزامنة</th>
                <th className="px-3 py-3 font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-border ${r.isActive ? "" : "opacity-60"}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.sourceName}</div>
                    {r.lastSyncStatus === "error" && r.lastSyncError && (
                      <div className="mt-0.5 max-w-64 truncate text-xs text-destructive" title={r.lastSyncError}>آخر خطأ: {r.lastSyncError}</div>
                    )}
                    {/* حد أمان أول مزامنة: شيت مليان — لا إدخال حتى يقرر المالك (ثلاثة خيارات) */}
                    {r.lastSyncStatus === "pending_choice" && (
                      <div className="mt-1.5 max-w-md rounded-lg border border-warning/40 bg-warning/10 p-2">
                        <div className="mb-1.5 text-xs font-medium text-warning">⚠️ {r.lastSyncError ?? "الشيت مليان — ابدأ من آخر صف بدل البداية؟"}</div>
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" disabled={pending} onClick={() => { if (window.confirm("متأكد؟ سيُدخل الشيت كاملًا من أول صف (على دفعات ٥٠ كل دورة).")) run(() => approveFullSync(r.id)); }} className="rounded-lg border border-warning/50 bg-warning/15 px-2.5 py-1 text-[11px] font-medium text-warning hover:bg-warning/25 disabled:opacity-40">زامن الكل</button>
                          <button type="button" disabled={pending} onClick={() => runLastTwoDays(r.id)} className="rounded-lg border border-gold/50 bg-gold/10 px-2.5 py-1 text-[11px] font-medium text-gold hover:bg-gold/20 disabled:opacity-40" title="يلتقط صفوف آخر ٤٨ ساعة (بعمود التاريخ) ثم يتحول لايف">آخر يومين ثم لايف</button>
                          <button type="button" disabled={pending} onClick={() => run(() => startSyncFromNow(r.id))} className="rounded-lg border border-success/50 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success hover:bg-success/20 disabled:opacity-40">ابدأ من الآن فقط</button>
                        </div>
                        {/* بلا عمود تاريخ مكتشَف: كم صفًا أخيرًا؟ */}
                        {askCountFor?.linkId === r.id && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background/60 p-1.5">
                            <span className="text-[11px] text-muted-foreground">الورقة بلا عمود تاريخ ({toArabicDigits(askCountFor.totalRows)} صف) — كم صفًا أخيرًا تريد التقاطه؟</span>
                            <input value={lastCount} onChange={(e) => setLastCount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" placeholder="20" className="w-16 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-gold" />
                            <button type="button" disabled={pending || !lastCount} onClick={() => runLastTwoDays(r.id, Number(lastCount))} className="rounded border border-gold/50 bg-gold/10 px-2 py-1 text-[11px] text-gold hover:bg-gold/20 disabled:opacity-40">التقط</button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3"><span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground">{channelLabels[r.channel]}</span></td>
                  <td className="px-3 py-3 text-center">
                    <div className="font-bold text-gold">{toArabicDigits(r.todayCount)}</div>
                    {/* عدّادات التحليل: قواعد · AI · مراجعة */}
                    {(r.ruleCount + r.aiCount + r.reviewCount) > 0 && (
                      <div className="mt-0.5 whitespace-nowrap text-[10px] text-muted-foreground" title="كيف حُلّلت صفوف هذا المصدر">
                        قواعد <span className="text-foreground">{toArabicDigits(r.ruleCount)}</span> · AI <span className="text-info">{toArabicDigits(r.aiCount)}</span> · مراجعة <span className="text-warning">{toArabicDigits(r.reviewCount)}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center text-muted-foreground" title="آخر صف مُعالج — القراءة تكمل من بعده">{toArabicDigits(r.lastRowSynced)}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {r.lastSyncAt ? formatDateTime(r.lastSyncAt) : "لسة ما زامن"}
                    {r.lastSyncStatus === "success" && <span className="mr-1 text-success">✓</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <button type="button" disabled={pending} onClick={() => run(() => toggleSheetLink(r.id, !r.isActive))} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40 ${r.isActive ? "border-warning/50 bg-warning/10 text-warning hover:bg-warning/20" : "border-success/50 bg-success/10 text-success hover:bg-success/20"}`}>
                        {r.isActive ? "إيقاف" : "تفعيل"}
                      </button>
                      <button type="button" disabled={pending} onClick={() => doTest(r.sheetUrl)} className="rounded-lg border border-info/50 bg-info/10 px-2.5 py-1.5 text-xs text-info hover:bg-info/20 disabled:opacity-40">جرّب</button>
                      <button type="button" disabled={pending} onClick={() => { if (window.confirm(`متأكد من حذف شيت «${r.sourceName}»؟ عملاؤه الحاليون ما ينحذفون.`)) run(() => deleteSheetLink(r.id)); }} className="rounded-lg border border-destructive/50 bg-destructive/10 p-1.5 text-destructive hover:bg-destructive/20 disabled:opacity-40" title="حذف الرابط" aria-label="حذف">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] leading-5 text-muted-foreground">
        كل عميل جديد يمر بحارس المكررات (نفس الرقم + نفس المصدر خلال ٤٨ ساعة ← صفحة المكررين لا التوزيع) ثم يلتقطه التوزيع التلقائي طبيعيًا. المزامنة تلف على المفعّلين كل دورة (دقيقتين) — إيقاف مصدر يوقفه وحده.
      </p>
    </section>
  );
}
