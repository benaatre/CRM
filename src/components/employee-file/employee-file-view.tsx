"use client";

import "./employee-file.css";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toArabicDigits } from "@/lib/format";
import type { EFBundle, EFDayCard } from "./types";
import { EmployeeFileRail } from "./employee-file-rail";
import { CheckoutModal } from "./checkout-modal";

/**
 * ملف الموظف — الكابينة (المرجع الملزم docs/design/employee-file-2026.html، مطابقة حرفية).
 * كل البيانات من الحزمة الخادمية EFBundle؛ الفلاتر تُعاد عبر searchParams (لا endpoints جديدة).
 * أدوات المالك تستدعي مسارات v3 القائمة حصريًا — وكل إجراء يُقيَّد بالتدقيق خادميًا.
 */

const AR_M = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const LOCK_SVG = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ display: "inline", verticalAlign: -1 }} aria-hidden>
    <rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" />
  </svg>
);

export type ToastFn = (msg: string, err?: boolean) => void;

function Strip({ card }: { card: EFDayCard }) {
  return (
    <div className="strip-wrap">
      <div className="strip">
        {card.window && (
          <div className="seg win" style={{ right: `${card.window.a}%`, width: `${Math.max(0, card.window.b - card.window.a)}%` }} />
        )}
        {card.segs.map((g, i) => (
          <div key={i} className={`seg ${g.cls}`} style={{ right: `${g.a}%`, width: `${Math.max(0.5, g.b - g.a)}%` }} />
        ))}
        {card.marks.map((m, i) => (
          <div key={i} className="mark" style={{ right: `${m.pct}%`, background: m.color }}>
            <span className="num">{m.label}</span>
          </div>
        ))}
      </div>
      <div className="scaleAbs">
        <span style={{ right: "0%" }}>٨ ص</span><span style={{ right: "28.6%" }}>١٢ م</span>
        <span style={{ right: "57.1%" }}>٤ م</span><span style={{ right: "85.7%" }}>٨ م</span>
        <span style={{ right: "100%" }}>١٠ م</span>
      </div>
    </div>
  );
}

function DayCardView({ card }: { card: EFDayCard | null }) {
  if (!card) {
    return <div className="subtxt" style={{ padding: "20px 0" }}>ما فيه بيانات لهذا اليوم.</div>;
  }
  return (
    <div className="dayline">
      <div className="dl-top">
        <div className="dl-big num">{card.bigHM}</div>
        <div className="dl-meta">
          {card.metaTop}
          <br />
          <span style={{ color: "var(--green-l)" }}>■</span> مؤكّد بالموقع{" "}
          <span style={{ color: "var(--amber-l)", marginInlineStart: 7 }}>■</span> غير مؤكّد{" "}
          <span style={{ color: "var(--gold)", marginInlineStart: 7 }}>┄</span> نافذة الحضور
        </div>
      </div>
      <Strip card={card} />
      <div className="evlist">
        {card.events.length === 0 && <div className="subtxt">لا أحداث مسجّلة.</div>}
        {card.events.map((e, i) => (
          <div className="ev" key={i}>
            <span className="tm num">{e.t}</span>
            <span className="dot" style={{ background: e.c }} />
            <div className="b2">
              {e.b}
              {e.s && <div className="s2">{e.s}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmployeeFileView({ bundle, basePath }: { bundle: EFBundle; basePath: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [day, setDay] = useState<"today" | "yday">("today");
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // الإعدادات القابلة للتعديل فعليًا (schedule PATCH) — تتزامن بين اللوحة والعمود الجانبي.
  const [winStart, setWinStart] = useState(bundle.schedule.startMinutes);
  const [winEnd, setWinEnd] = useState(bundle.schedule.startWindowEndMinutes ?? bundle.schedule.startMinutes + 120);
  const [goalHours, setGoalHours] = useState(Math.round(bundle.schedule.shiftMinutes / 60));
  const [savingSched, setSavingSched] = useState(false);

  const showToast: ToastFn = useCallback((msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 4600);
  }, []);

  const nav = useCallback(
    (patch: Record<string, string | null>) => {
      const sp = new URLSearchParams();
      const cur: Record<string, string | null> = {
        p: bundle.period, view: bundle.view, month: bundle.month,
        from: bundle.rangeFrom, to: bundle.rangeTo, ...patch,
      };
      for (const [k, v] of Object.entries(cur)) if (v) sp.set(k, v);
      startTransition(() => router.replace(`${basePath}?${sp.toString()}`, { scroll: false }));
    },
    [router, basePath, bundle.period, bundle.view, bundle.month, bundle.rangeFrom, bundle.rangeTo],
  );

  const saveSchedule = useCallback(async () => {
    setSavingSched(true);
    try {
      const res = await fetch(`/api/attendance/schedule/${bundle.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startMinutes: winStart, shiftMinutes: goalHours * 60, startWindowEndMinutes: winEnd }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        showToast("✓ حُفظت الإعدادات · قُيّدت بسجل التدقيق باسمك ووقتها");
        startTransition(() => router.refresh());
      } else showToast(d.error ?? "تعذّر الحفظ", true);
    } catch {
      showToast("تعذّر الاتصال — حاول مرة ثانية", true);
    }
    setSavingSched(false);
  }, [bundle.user.id, winStart, winEnd, goalHours, router, showToast]);

  const card = day === "today" ? bundle.today : bundle.yesterday;
  const histMax = Math.max(1, ...bundle.histogram);
  const fusMax = Math.max(1, ...bundle.fus14.map((f) => f.count));
  const stageMax = Math.max(1, ...bundle.stages.map((s) => s.count));
  const donutOffset = bundle.attKpis.confirmPct !== null ? 226 - (226 * bundle.attKpis.confirmPct) / 100 : 226;

  const periodLabel = { w: "الأسبوع", m: AR_M[Number(bundle.month.slice(5)) - 1], q: "٩٠ يوم" } as const;
  const gv = bundle.globalView;
  const weekend = new Set(gv.weekendDays.split(","));
  const DAY_CHIPS: [string, string][] = [["SUN", "الأحد"], ["MON", "الاثنين"], ["TUE", "الثلاثاء"], ["WED", "الأربعاء"], ["THU", "الخميس"], ["FRI", "الجمعة"], ["SAT", "السبت"]];

  const exportCsv = useCallback(() => {
    const head = "اليوم,الحالة,الحضور-الانصراف,الساعات,مقفول,إجازة";
    const lines = bundle.logDays.map((d) =>
      [d.dayNum + " " + d.dayName, d.status, d.io ?? "", d.hoursHM ?? "", d.locked ? "نعم" : "", d.leaveTag ? "مستثنى" : ""].join(","),
    );
    const blob = new Blob(["﻿" + [head, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `attendance-${bundle.user.name}-${bundle.month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("✓ صُدّر السجل الظاهر ملف CSV");
  }, [bundle.logDays, bundle.user.name, bundle.month, showToast]);

  /* منتقي الشهر + تقويم المدى */
  const [monthOpen, setMonthOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [calCursor, setCalCursor] = useState(bundle.month);
  const [selA, setSelA] = useState<string | null>(bundle.rangeFrom);
  const [selB, setSelB] = useState<string | null>(bundle.rangeTo);
  const todayKey = useMemo(() => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10), []);
  const calDays = useMemo(() => {
    const [y, m] = calCursor.split("-").map(Number);
    const first = new Date(Date.UTC(y!, m! - 1, 1));
    const dim = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    return { lead: first.getUTCDay(), dim, y: y!, m: m! };
  }, [calCursor]);

  const winLabel = (min: number) => `${toArabicDigits(min / 60 > 12 ? min / 60 - 12 : min / 60)} ${min < 720 ? "ص" : "م"}`;

  return (
    <div className="ef" dir="rtl">
      <div className="wrap">
        <div className="cockpit" style={pending ? { opacity: 0.65, transition: "opacity .2s" } : undefined}>
          {/* ═════ العمود الرئيسي ═════ */}
          <div className="main">
            {/* رادار اليوم */}
            <div className="radar">
              <div className="rh2">
                <h3>سجل اليوم — خط الزمن</h3>
                <div className="dayseg">
                  <button type="button" className={day === "today" ? "on" : ""} onClick={() => setDay("today")}>اليوم</button>
                  <button type="button" className={day === "yday" ? "on" : ""} onClick={() => setDay("yday")}>أمس</button>
                </div>
                <span className="sp" />
                {card && (
                  <span className={`state ${card.state.cls === "ok" ? "ok" : ""}`}>
                    {card.state.lock && LOCK_SVG}
                    {card.state.text}
                  </span>
                )}
              </div>
              <DayCardView card={card} />
            </div>

            {/* لوحة الإلزام */}
            <div className="card">
              <h4>
                إلزام البصمة <span className="hc">اختر الوضع — وكل وضع بإعداداته تحته · الحفظ يُقيَّد بالتدقيق باسمك</span>
              </h4>
              <div className="modes">
                <div className={`mode locked ${bundle.enforcement.mode === "STRICT" ? "on" : ""}`} title="تبديل الأوضاع غير موصول بعد — النظام الكامل مفعّل للجميع (م٤ج)">
                  <span className="radio" />
                  <div className="mt">ملزمة بالبصمة</div>
                  <div className="md">النظام الكامل: بصمة ونداءات وتأخر وغياب.</div>
                </div>
                <div className={`mode m-watch locked ${bundle.enforcement.mode === "WATCH_ONLY" ? "on" : ""}`} title="تبديل الأوضاع غير موصول بعد (م٤ج)">
                  <span className="radio" />
                  <div className="mt">مراقبة فقط</div>
                  <div className="md">بلا إلزام — يُسجَّل الاتصال والتواجد فقط.</div>
                </div>
                <div className={`mode m-off locked ${bundle.enforcement.mode === "EXEMPT" ? "on" : ""}`} title="تبديل الأوضاع غير موصول بعد (م٤ج)">
                  <span className="radio" />
                  <div className="mt">معفاة مؤقتًا</div>
                  <div className="md">إيقاف كامل حتى تاريخ تحدده.</div>
                </div>
              </div>
              <div className="subpanel on">
                <div className="subgrid">
                  <div className="fld sub2">
                    <div className="fl">نافذة البداية المرنة</div>
                    <div className="chips">
                      {[480, 540, 600].map((v) => (
                        <button key={v} type="button" className={`chip ${winStart === v ? "on" : ""}`} onClick={() => setWinStart(v)}>
                          {winLabel(v)}
                        </button>
                      ))}
                      <span style={{ color: "var(--muted)", fontSize: 11, padding: "6px 2px" }}>إلى</span>
                      {[600, 660, 720].map((v) => (
                        <button key={v} type="button" className={`chip ${winEnd === v ? "on" : ""}`} onClick={() => setWinEnd(v)} disabled={v <= winStart}>
                          {winLabel(v)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fld">
                    <div className="fl">هدف اليوم — ساعات</div>
                    <div className="stepper">
                      <button type="button" onClick={() => setGoalHours((g) => Math.max(4, g - 1))}>−</button>
                      <span className="sv num">{toArabicDigits(goalHours)}</span>
                      <button type="button" onClick={() => setGoalHours((g) => Math.min(12, g + 1))}>+</button>
                    </div>
                  </div>
                  <div className="fld" title="إعداد عام لكل الفريق — يُضبط من حوكمة الدوام">
                    <div className="fl">نداءات عشوائية/يوم — عام</div>
                    <div className="stepper">
                      <button type="button" disabled>−</button>
                      <span className="sv num">{toArabicDigits(gv.verificationPerDay)}</span>
                      <button type="button" disabled>+</button>
                    </div>
                  </div>
                  <div className="fld sub2" title="إعداد عام لكل الفريق — يُضبط من حوكمة الدوام">
                    <div className="fl">أيام العمل — عام</div>
                    <div className="chips">
                      {DAY_CHIPS.map(([code, label]) => (
                        <button key={code} type="button" className={`chip ${weekend.has(code) ? "" : "on"}`} disabled>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fld sub2">
                    <div className="fl">سلوك النظام — عام</div>
                    <div className="frow">
                      <div>نداء خروج النطاق<div className="d">مهلة {toArabicDigits(gv.maxOutOfZoneMinutes)} د</div></div>
                      <button type="button" className="tog on" disabled aria-label="إعداد عام" />
                    </div>
                    <div className="frow">
                      <div>نداءات التحقق<div className="d">مفعّلة لكل الفريق</div></div>
                      <button type="button" className={`tog ${gv.verificationEnabled ? "on" : ""}`} disabled aria-label="إعداد عام" />
                    </div>
                  </div>
                </div>
                <div className="lockhint">
                  الأوضاع الثلاثة والإعدادات الموسومة «عام» غير قابلة للتخصيص لكل موظف بعد — القابل للحفظ هنا: النافذة وهدف اليوم (يُقيَّد بالتدقيق).
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 14 }}>
                <button type="button" className="btn gold mini" onClick={() => void saveSchedule()} disabled={savingSched}>
                  {savingSched ? "جاري الحفظ…" : "حفظ الإعدادات"}
                </button>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>أي تغيير يُقيَّد بسجل التدقيق باسمك ووقته</span>
              </div>
            </div>

            {/* مؤشرات الدوام */}
            <div className="sechead">
              <span className="bar" /><h3>مؤشرات الدوام</h3><span className="sp" />
              <div className="fseg">
                {(["w", "m", "q"] as const).map((p) => (
                  <button key={p} type="button" className={bundle.period === p ? "on" : ""} onClick={() => nav({ p })}>
                    {periodLabel[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="kwrap">
              <div className="kpi c-gold"><div className="kv num">{toArabicDigits(bundle.attKpis.workDays)}</div><div className="kl">أيام دوام</div></div>
              <div className="kpi c-green"><div className="kv num">{bundle.attKpis.confirmedHM}</div><div className="kl">ساعات مؤكّدة</div></div>
              <div className="kpi c-amber"><div className="kv num">{bundle.attKpis.unconfHM}</div><div className="kl">غير مؤكّد</div></div>
              <div className="kpi c-teal"><div className="kv num">{toArabicDigits(bundle.attKpis.leaveDays)}</div><div className="kl">إجازة معتمدة</div></div>
              <div className="kpi c-red"><div className="kv num">{toArabicDigits(bundle.attKpis.absentDays)}</div><div className="kl">غياب</div></div>
              <div className="kpi c-teal"><div className="kv num">{bundle.attKpis.compliancePct !== null ? `${toArabicDigits(bundle.attKpis.compliancePct)}٪` : "—"}</div><div className="kl">الالتزام</div></div>
            </div>
            <div className="panelrow">
              <div className="card an">
                <h4>توزيع أوقات الحضور — متى يبصم عادة؟</h4>
                <div className="hist">
                  {bundle.histogram.map((v, i) => (
                    <div key={i} className={`hb ${v > 0 && v === Math.max(...bundle.histogram) ? "hot" : v >= histMax * 0.5 ? "hot" : ""}`} style={{ height: `${Math.max(4, (v / histMax) * 100)}%` }} title={toArabicDigits(v)} />
                  ))}
                </div>
                <div className="histlbl"><span>٨ص</span><span>٩ص</span><span>١٠ص</span><span>١١ص</span><span>١٢م</span><span>١م</span><span>٢م</span></div>
                <div className="subtxt">
                  {bundle.histPeakLabel
                    ? <>ذروة بصماته <b style={{ color: "var(--amber-l)" }}>{bundle.histPeakLabel}</b> — من بيانات المدى المختار.</>
                    : "ما فيه بصمات في المدى المختار."}
                </div>
              </div>
              <div className="card an">
                <h4>نسبة التأكيد بإثبات الموقع</h4>
                <div className="center">
                  <svg width="88" height="88" viewBox="0 0 88 88">
                    <circle cx="44" cy="44" r="36" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="9" />
                    <circle cx="44" cy="44" r="36" fill="none" stroke="#46A758" strokeWidth="9" strokeLinecap="round" strokeDasharray="226" strokeDashoffset={donutOffset} transform="rotate(-90 44 44)" />
                  </svg>
                  <div>
                    <div className="num" style={{ fontSize: 29, color: "var(--green-l)" }}>
                      {bundle.attKpis.confirmPct !== null ? `${toArabicDigits(bundle.attKpis.confirmPct)}٪` : "—"}
                    </div>
                    <div className="subtxt" style={{ marginTop: 5 }}>من وقته مثبت بموقع فعلي — الباقي «غير مؤكّد»</div>
                  </div>
                </div>
              </div>
            </div>

            {/* النشاط والإنجاز */}
            <div className="sechead b-blue">
              <span className="bar" /><h3>النشاط والإنجاز</h3><span className="sp" />
              <span style={{ fontSize: 10, color: "var(--muted)" }}>من نظام العملاء — نفس الفلتر</span>
            </div>
            <div className="kwrap">
              <div className="kpi c-blue"><div className="kv num">{toArabicDigits(bundle.crm.followups)}</div><div className="kl">متابعة</div></div>
              <div className="kpi c-blue"><div className="kv num">{toArabicDigits(bundle.crm.activeLeads)}</div><div className="kl">عميل نشط</div></div>
              <div className="kpi c-purple"><div className="kv num">{toArabicDigits(bundle.crm.visits)}</div><div className="kl">زيارات</div></div>
              <div className="kpi c-gold"><div className="kv num">{toArabicDigits(bundle.crm.bookings)}</div><div className="kl">حجوزات</div></div>
              <div className="kpi c-green"><div className="kv num">{bundle.crm.apptPct !== null ? `${toArabicDigits(bundle.crm.apptPct)}٪` : "—"}</div><div className="kl">التزام المواعيد</div></div>
              <div className="kpi c-teal"><div className="kv num">{bundle.crm.firstRespHM ?? "—"}</div><div className="kl">سرعة أول رد (س)</div></div>
            </div>
            <div className="panelrow">
              <div className="card an">
                <h4>متابعاته — آخر ١٤ يوم (الرمادي = غيابه)</h4>
                <div className="hist">
                  {bundle.fus14.map((f) => (
                    <div key={f.key} className={`hb ${f.off || f.count === 0 ? "" : "b"}`} style={{ height: `${Math.max(4, (f.count / fusMax) * 100)}%` }} title={`${f.dayNum}: ${toArabicDigits(f.count)}`} />
                  ))}
                </div>
                <div className="histlbl">{bundle.fus14.map((f) => <span key={f.key}>{f.dayNum}</span>)}</div>
              </div>
              <div className="card an">
                <h4>مراحل عملائه الآن</h4>
                <div className="cmp">
                  {bundle.stages.length === 0 && <div className="subtxt">ما عنده عملاء نشطون.</div>}
                  {bundle.stages.map((s, i) => {
                    const colors = [
                      "linear-gradient(90deg,var(--green),var(--green-l))",
                      "linear-gradient(90deg,#3f8fa3,#5bbccb)",
                      "linear-gradient(90deg,#4a6fa8,var(--blue))",
                      "linear-gradient(90deg,#7a63a8,var(--purple))",
                    ];
                    return (
                      <div className="cr" key={s.key}>
                        <span className="cl">{s.label}</span>
                        <div className="cb"><i style={{ width: `${Math.max(10, (s.count / stageMax) * 100)}%`, background: colors[i % 4] }}>{toArabicDigits(s.count)}</i></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* الدوام × الإنجاز */}
            <div className="sechead b-purple"><span className="bar" /><h3>الدوام × الإنجاز</h3></div>
            <div className="merge">
              <div className="mgrid">
                <div className="mhero">
                  <div className="mv num">{bundle.merge.perHour ?? "—"}</div>
                  <div className="ml">
                    <b>متابعة لكل ساعة مؤكّدة</b>
                    <br />
                    {bundle.merge.teamPerHour !== null && bundle.merge.above !== null
                      ? <>{bundle.merge.above ? "فوق" : "تحت"} معدل الفريق ({bundle.merge.teamPerHour}) — {bundle.merge.above ? "لما يحضر ينتج فوق المعدل." : "حضوره وإنتاجه يحتاجان نظرة."}</>
                      : "ما يكفي من الساعات المؤكّدة في المدى لحساب المعدل."}
                  </div>
                </div>
                <div className="cmp">
                  {([["يوم كامل", bundle.merge.avgFull, "linear-gradient(90deg,var(--green),var(--green-l))"], ["يوم جزئي", bundle.merge.avgPartial, "linear-gradient(90deg,var(--amber),var(--amber-l))"], ["يوم غياب", bundle.merge.avgAbsent, "linear-gradient(90deg,var(--red),#ff8b8e)"]] as const).map(([label, v, bg]) => {
                    const max = Math.max(bundle.merge.avgFull ?? 0, bundle.merge.avgPartial ?? 0, bundle.merge.avgAbsent ?? 0, 1);
                    return (
                      <div className="cr" key={label}>
                        <span className="cl">{label}</span>
                        <div className="cb">
                          {v !== null
                            ? <i style={{ width: `${Math.max(9, (v / max) * 100)}%`, background: bg }}>~{toArabicDigits(v)} متابعة/يوم</i>
                            : <i style={{ width: "9%", background: "rgba(255,255,255,.08)", color: "var(--muted)" }}>—</i>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {bundle.merge.insights.length > 0 && (
                <div className="insights">
                  {bundle.merge.insights.map((ins, i) => (
                    <div className="ins" key={i}>
                      <span className={`tag ${ins.tag}`}>{ins.tag === "g" ? "قوة" : ins.tag === "a" ? "فرصة" : "نمط"}</span>
                      <div className="it">{ins.title}</div>
                      <div className="is">{ins.sub}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* السجل */}
            <div className="sechead"><span className="bar" /><h3>السجل</h3></div>
            <div className="card">
              <div className="logbar">
                <div className="vseg">
                  <button type="button" className={bundle.view === "week" ? "on" : ""} onClick={() => nav({ view: "week", from: null, to: null })}>الأسبوع</button>
                  <button type="button" className={bundle.view === "month" ? "on" : ""} onClick={() => nav({ view: "month", from: null, to: null })}>الشهر</button>
                </div>
                <div className={`msel ${monthOpen ? "open" : ""}`}>
                  <div className="cur" onClick={() => setMonthOpen((v) => !v)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
                    <span>{bundle.monthOptions.find((m) => m.value === bundle.month)?.label ?? bundle.month}</span>
                  </div>
                  <div className="list">
                    {bundle.monthOptions.map((m) => (
                      <div key={m.value} className={m.value === bundle.month ? "on" : ""} onClick={() => { setMonthOpen(false); nav({ view: "month", month: m.value, from: null, to: null }); }}>
                        {m.label} {m.current && <span>الحالي</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ position: "relative" }}>
                  <button type="button" className="rangebtn" onClick={() => setCalOpen((v) => !v)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>
                    <span>
                      {bundle.view === "range" && bundle.rangeFrom && bundle.rangeTo
                        ? `${toArabicDigits(Number(bundle.rangeFrom.slice(8)))} ${AR_M[Number(bundle.rangeFrom.slice(5, 7)) - 1]} — ${toArabicDigits(Number(bundle.rangeTo.slice(8)))} ${AR_M[Number(bundle.rangeTo.slice(5, 7)) - 1]}`
                        : "بحث بمدى: من — إلى"}
                    </span>
                  </button>
                  <div className={`calpop ${calOpen ? "on" : ""}`}>
                    <div className="ch">
                      <div className="nav"><span onClick={() => setCalCursor((c) => { const [y, m] = c.split("-").map(Number); return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`; })}>‹</span></div>
                      <b>{AR_M[calDays.m - 1]} {toArabicDigits(calDays.y)}</b>
                      <div className="nav"><span onClick={() => setCalCursor((c) => { const [y, m] = c.split("-").map(Number); return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`; })}>›</span></div>
                    </div>
                    <div className="calgrid">
                      {["ح", "ن", "ث", "ر", "خ", "ج", "س"].map((h) => <div className="h" key={h}>{h}</div>)}
                      {Array.from({ length: calDays.lead }, (_, i) => <div key={`e${i}`} />)}
                      {Array.from({ length: calDays.dim }, (_, i) => {
                        const key = `${calCursor}-${String(i + 1).padStart(2, "0")}`;
                        const dis = key > todayKey;
                        const sel = key === selA || key === selB;
                        const inr = selA && selB && key > selA && key < selB;
                        return (
                          <div
                            key={key}
                            className={`d ${dis ? "dis" : ""} ${sel ? "sel" : ""} ${inr ? "inrange" : ""}`}
                            onClick={() => {
                              if (!selA || (selA && selB)) { setSelA(key); setSelB(null); }
                              else if (key < selA) { setSelB(selA); setSelA(key); }
                              else setSelB(key);
                            }}
                          >
                            {toArabicDigits(i + 1)}
                          </div>
                        );
                      })}
                    </div>
                    <div className="hint">{!selA ? "اختر تاريخ البداية" : !selB ? "اختر تاريخ النهاية" : "اضغط «تطبيق»"}</div>
                    <div className="cf">
                      <button type="button" className="btn gold" onClick={() => { if (selA && selB) { setCalOpen(false); nav({ view: "range", from: selA, to: selB }); } }}>تطبيق</button>
                      <button type="button" className="btn ghost" onClick={() => { setSelA(null); setSelB(null); setCalOpen(false); if (bundle.view === "range") nav({ view: "month", from: null, to: null }); }}>مسح</button>
                    </div>
                  </div>
                </div>
                <span className="sp" />
                <span className="logsum">{bundle.logLabel}</span>
              </div>
              <div className="logtable">
                <table>
                  <thead>
                    <tr><th>اليوم</th><th>الحالة</th><th>الحضور ← الانصراف</th><th>مؤكّد/غير مؤكّد</th><th>الساعات</th><th></th></tr>
                  </thead>
                  <tbody>
                    {bundle.logDays.map((d) => {
                      const pill =
                        d.status === "full" ? <span className="pill p-ok">أكمل دوامه</span>
                        : d.status === "part" ? <span className="pill p-warn">داوم جزئيًا</span>
                        : d.status === "open" ? <span className="pill p-ok">جارٍ الآن</span>
                        : d.status === "wk" ? <span className="pill p-mute">عطلة</span>
                        : d.status === "fut" ? <span className="pill p-mute">قادم</span>
                        : d.status === "leave" ? <span className="pill p-leave">إجازة معتمدة</span>
                        : <span className="pill p-bad">غياب</span>;
                      return (
                        <tr key={d.key} className={d.status === "wk" || d.status === "fut" ? "dim" : ""}>
                          <td className="dn">{d.dayNum}<div className="dw">{d.dayName}</div></td>
                          <td>{pill}</td>
                          <td style={{ color: "var(--muted)" }}>{d.io ?? "—"}</td>
                          <td>
                            {d.status === "full" || d.status === "part" || d.status === "open"
                              ? <div className="bar2"><i style={{ width: `${d.confPct}%`, background: "#46A758" }} /><i style={{ width: `${d.uncPct}%`, background: "#E5A54D" }} /></div>
                              : <div className="bar2" />}
                          </td>
                          <td className="hrs" style={{ color: d.hoursHM ? "var(--text)" : "var(--muted)" }}>{d.hoursHM ?? "—"}</td>
                          <td>
                            {d.leaveTag
                              ? <span className="locktag" style={{ color: "var(--teal)" }}>مستثنى تلقائيًا</span>
                              : d.locked && <span className="locktag">{LOCK_SVG} مقفول</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ═════ العمود الجانبي ═════ */}
          <EmployeeFileRail
            bundle={bundle}
            showToast={showToast}
            onOpenCheckout={() => setCheckoutOpen(true)}
            onExport={exportCsv}
            winStart={winStart}
            winEnd={winEnd}
            goalHours={goalHours}
            setWinStart={setWinStart}
            setWinEnd={setWinEnd}
            setGoalHours={setGoalHours}
            onSaveSchedule={() => void saveSchedule()}
            savingSched={savingSched}
            refresh={() => startTransition(() => router.refresh())}
          />
        </div>
      </div>

      {checkoutOpen && (
        <CheckoutModal
          bundle={bundle}
          onClose={() => setCheckoutOpen(false)}
          showToast={showToast}
          refresh={() => startTransition(() => router.refresh())}
        />
      )}
      {toast && <div className={`ef-toast ${toast.err ? "err" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
