"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { LeadStage, FollowUpResult } from "@prisma/client";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel } from "@/lib/mobile-format";
import { formatTime, RIYADH_TZ } from "@/lib/format";
import { DAY_MS, dayStartKSA, ksaDayKey, ksaDayOfWeek, parseRiyadhLocal } from "@/lib/ksa-time";
import { followUpResultLabels } from "@/lib/labels";
import { markCall } from "@/lib/mobile-call-tracker";
import { FollowupSheet } from "@/components/mobile/followup-sheet";
import { EditFollowupSheet, editMinutesLeft } from "@/components/mobile/edit-followup-sheet";

/**
 * شاشة «متابعاتي» v3 — ٤ تبويبات (اليوم/فاتت/قادمة/السجل) بملخص ثلاثي وفلترين
 * متراكبين (النوع + الموعد). عرض وتغليف خالص: كل البيانات props من الخادم،
 * والأفعال عبر ورقتي المتابعة والتعديل القائمتين (POST/PATCH القائمين).
 * الحالات الزمنية بمؤقّت ٣٠ ثانية (cleanup) — نفس إيقاع الرئيسية.
 */

const MIN = 60_000;
const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)" };

export type FuAppointment = {
  leadId: string;
  name: string;
  phone: string;
  at: Date;
  kind: "visit" | "followup" | "new";
  reason: string;
  stage: LeadStage;
  firstContact: boolean;
};

export type FuLogItem = {
  id: string;
  leadId: string;
  leadName: string;
  result: FollowUpResult;
  note: string | null;
  nextDate: Date | null;
  createdAt: Date;
};

type TabKey = "today" | "missed" | "upcoming" | "log";
type KindKey = "all" | "fu" | "visit";
type RangeKey = "all" | "custom" | "tomorrow" | "week" | "next";

const KIND_CHIPS: { key: KindKey; label: string }[] = [
  { key: "all", label: "✓ الكل" },
  { key: "fu", label: "📞 متابعات" },
  { key: "visit", label: "🏠 زيارات" },
];
const RANGE_CHIPS: { key: RangeKey; label: string }[] = [
  { key: "all", label: "✓ الكل" },
  { key: "custom", label: "📅 من–إلى" },
  { key: "tomorrow", label: "بكرة" },
  { key: "week", label: "هذا الأسبوع" },
  { key: "next", label: "الأسبوع الجاي" },
];

// الساعة مثبّتة على الرياض (مصدر التنسيق الموحّد) — لا توقيت الجهاز/الخادم.
const fmtClock = formatTime;
function fmtDayTitle(d: Date, now: Date): string {
  // حدود «بكرة/بعد بكرة» بيوم الرياض لا بيوم الجهاز — ومنتصف الليل ما ينقلب يومًا سابقًا.
  const diff = Math.round((dayStartKSA(d).getTime() - dayStartKSA(now).getTime()) / DAY_MS);
  const w = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", timeZone: RIYADH_TZ, weekday: "long", day: "numeric", month: "short" }).format(d);
  if (diff === 1) return `بكرة — ${w}`;
  if (diff === 2) return `بعد بكرة — ${w}`;
  return w;
}
function minsOrHours(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / MIN));
  if (m < 60) return m === 1 ? "دقيقة" : m === 2 ? "دقيقتين" : `${toArabicDigits(m)} ${m <= 10 ? "دقائق" : "دقيقة"}`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${toArabicDigits(h)} ساعات`;
  const dd = Math.round(h / 24);
  return dd === 1 ? "يوم" : dd === 2 ? "يومين" : `${toArabicDigits(dd)} أيام`;
}
/** لون نوع الموعد: زيارة كهرماني · متابعة ذهبي · أول تواصل أزرق — والفائت أحمر. */
function toneOf(kind: FuAppointment["kind"], missed: boolean): { base: string; bg: string } {
  if (missed) return { base: MOBILE_COLORS.rose, bg: MOBILE_COLORS.roseBg };
  if (kind === "visit") return { base: MOBILE_COLORS.amber, bg: MOBILE_COLORS.amberBg };
  if (kind === "new") return { base: MOBILE_COLORS.sky, bg: MOBILE_COLORS.skyBg };
  return { base: MOBILE_COLORS.gold, bg: MOBILE_COLORS.goldBg };
}
function logTone(result: FollowUpResult): string {
  if (result.startsWith("NOT_INTERESTED")) return MOBILE_COLORS.rose;
  if (result.startsWith("NOT_ANSWERED") || result === "NO_ANSWER_INTERESTED" || result === "CALL_LATER") return MOBILE_COLORS.sky;
  if (result === "NEGOTIATING" || result === "BANK_CHECK" || result === "ON_HOLD") return MOBILE_COLORS.amber;
  return MOBILE_COLORS.mint;
}

const chipStyle = (on: boolean, base?: string, bg?: string) => ({
  boxSizing: "border-box" as const, height: 32, padding: "0 13px", borderRadius: 16,
  fontSize: 12, fontWeight: 600 as const, border: `1px solid ${on ? (base ?? MOBILE_COLORS.gold) : MOBILE_COLORS.border}`,
  ...(on
    ? { background: bg ?? MOBILE_COLORS.goldBg, color: base ?? MOBILE_COLORS.gold }
    : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary }),
});

export function FollowupsScreen({
  todayAppointments, missedOld, upcoming, log, unread, projects, initialTab,
}: {
  /** مواعيد اليوم كاملة (بما فيها الفائتة اليوم) — من buildAgenda/buildDayAppointments. */
  todayAppointments: FuAppointment[];
  /** الفائت من الأيام السابقة (متابعات متأخرة + زيارات معلّقة قديمة). */
  missedOld: FuAppointment[];
  /** المواعيد المستقبلية (بعد اليوم) — تُجمَّع بالأيام هنا. */
  upcoming: FuAppointment[];
  /** سجل منجزاته (حتى ٤٠ — «عرض المزيد» محلي). */
  log: FuLogItem[];
  unread: number;
  projects: { id: string; name: string }[];
  initialTab?: string;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [tab, setTab] = useState<TabKey>(
    initialTab === "late" ? "missed" : initialTab === "log" ? "log" : initialTab === "upcoming" ? "upcoming" : "today",
  );
  const [kind, setKind] = useState<KindKey>("all");
  const [range, setRange] = useState<RangeKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [logShown, setLogShown] = useState(10);
  const [fuSheet, setFuSheet] = useState<FuAppointment | null>(null);
  const [editItem, setEditItem] = useState<FuLogItem | null>(null);

  const now = new Date(nowMs);
  const missedToday = todayAppointments.filter((a) => a.at.getTime() < nowMs);
  const missedAll = [...missedToday, ...missedOld];
  const kindOk = (a: FuAppointment) => kind === "all" || (kind === "visit" ? a.kind === "visit" : a.kind !== "visit");

  // فلتر الموعد يسري على «قادمة» — اختياره ينقل إليها تلقائيًا (المواصفة).
  const pickRange = (r: RangeKey) => {
    setRange(r);
    if (r !== "all") setTab("upcoming");
  };

  const upcomingFiltered = useMemo(() => {
    // كل الحدود بيوم الرياض (بداية اليوم ويوم الأسبوع) — لا توقيت الجهاز.
    const dayMs = DAY_MS;
    const t0 = dayStartKSA(now).getTime();
    const dow = ksaDayOfWeek(now);
    let lo = -Infinity, hi = Infinity;
    if (range === "tomorrow") { lo = t0 + dayMs; hi = t0 + 2 * dayMs; }
    else if (range === "week") { lo = t0; hi = t0 + (7 - (dow % 7 === 0 ? 7 : dow % 7)) * dayMs + dayMs; }
    else if (range === "next") {
      const daysToSun = (7 - dow) % 7 || 7;
      lo = t0 + daysToSun * dayMs; hi = lo + 7 * dayMs;
    } else if (range === "custom") {
      if (from) lo = parseRiyadhLocal(from).getTime();
      if (to) hi = parseRiyadhLocal(to).getTime() + dayMs;
    }
    return upcoming.filter((a) => kindOk(a) && a.at.getTime() >= lo && a.at.getTime() < hi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming, kind, range, from, to, nowMs]);

  const upcomingGroups = useMemo(() => {
    const map = new Map<string, { title: string; items: FuAppointment[] }>();
    for (const a of upcomingFiltered) {
      const key = ksaDayKey(a.at); // التجميع بيوم الرياض — نفس حدود العناوين
      const g = map.get(key) ?? { title: fmtDayTitle(a.at, now), items: [] };
      g.items.push(a);
      map.set(key, g);
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingFiltered]);

  const summary = [
    { key: "today" as TabKey, label: "اليوم", n: todayAppointments.length, base: MOBILE_COLORS.gold, bg: MOBILE_COLORS.goldBg, border: MOBILE_COLORS.goldBorder },
    { key: "missed" as TabKey, label: "فاتت", n: missedAll.length, base: MOBILE_COLORS.rose, bg: MOBILE_COLORS.roseBg, border: MOBILE_COLORS.rose },
    { key: "upcoming" as TabKey, label: "قادمة", n: upcoming.length, base: MOBILE_COLORS.sky, bg: MOBILE_COLORS.skyBg, border: MOBILE_COLORS.border },
  ];
  const TABS: { key: TabKey; label: string }[] = [
    { key: "today", label: "اليوم" },
    { key: "missed", label: "فاتت" },
    { key: "upcoming", label: "قادمة" },
    { key: "log", label: "السجل" },
  ];

  /** كرت موعد — بصندوق وقت وسطر سبب وأزرار حسب التبويب. */
  const AppointmentCard = ({ a, showMissedLine, cta }: { a: FuAppointment; showMissedLine: boolean; cta: string | null }) => {
    const missed = a.at.getTime() < nowMs;
    const soon = !missed && a.at.getTime() - nowMs <= 60 * MIN;
    const tone = toneOf(a.kind, missed);
    return (
      <div
        className="relative overflow-hidden"
        style={{
          boxSizing: "border-box", background: MOBILE_COLORS.card,
          border: `1px solid ${missed ? MOBILE_COLORS.rose : MOBILE_COLORS.border}`,
          borderRadius: 15, padding: "12px 14px",
        }}
      >
        <span aria-hidden style={{ position: "absolute", insetInlineStart: 0, top: 9, bottom: 9, width: 4, borderRadius: 3, background: tone.base, boxShadow: `0 0 10px ${tone.base}` }} />
        <div className="flex items-center" style={{ gap: 10 }}>
          <div
            className="flex-none text-center"
            style={{ boxSizing: "border-box", borderRadius: 11, padding: "6px 10px", background: tone.bg }}
          >
            <div style={{ ...ZAIN, fontSize: 16, fontWeight: 800, lineHeight: 1, color: tone.base }}>{fmtClock(a.at)}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center" style={{ gap: 6 }}>
              <Link href={`/m/leads/${a.leadId}`} className="min-w-0 truncate" style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
                {a.name}
              </Link>
              {missed && <span className="flex-none" style={{ boxSizing: "border-box", borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700, background: MOBILE_COLORS.roseBg, color: MOBILE_COLORS.rose }}>فاتت</span>}
              {soon && <span className="flex-none" style={{ boxSizing: "border-box", borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700, background: MOBILE_COLORS.amberBg, color: MOBILE_COLORS.amber }}>الآن</span>}
            </div>
            <div className="truncate" style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginTop: 3 }}>{a.reason}</div>
            {showMissedLine && missed && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: MOBILE_COLORS.rose, marginTop: 4 }}>
                ⚠️ فات من {minsOrHours(nowMs - a.at.getTime())}
              </div>
            )}
          </div>
          <Link
            href={`/m/leads/${a.leadId}`}
            aria-label={`ملف العميل ${a.name}`}
            className="m-press flex flex-none items-center justify-center"
            style={{ boxSizing: "border-box", width: 40, height: 38, borderRadius: 10, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textSecondary, fontSize: 14 }}
          >
            ←
          </Link>
        </div>
        {cta && (missed || soon) && (
          <div className="flex" style={{ gap: 8, marginTop: 10 }}>
            <a
              href={`tel:${a.phone}`}
              onClick={() => markCall(a.leadId)}
              className="m-press flex flex-1 items-center justify-center"
              style={{ boxSizing: "border-box", height: 38, borderRadius: 10, border: "none", background: missed ? MOBILE_COLORS.rose : MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 12.5, fontWeight: 700 }}
            >
              📞 اتصال
            </a>
            <button
              type="button"
              onClick={() => setFuSheet(a)}
              className="m-press flex items-center justify-center"
              style={{ boxSizing: "border-box", flex: 1.6, height: 38, borderRadius: 10, background: MOBILE_COLORS.sheet, border: `1px solid ${tone.base}`, color: tone.base, fontSize: 12.5, fontWeight: 700 }}
            >
              {cta}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      {/* ===== الترويسة ===== */}
      <header className="flex items-center justify-between" style={{ padding: "0 2px", gap: 10 }}>
        <div className="min-w-0">
          <h1 style={{ fontSize: 22, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>متابعاتي</h1>
          <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginTop: 4 }}>
            اليوم <span style={{ ...ZAIN, fontWeight: 800, color: MOBILE_COLORS.gold }}>{toArabicDigits(todayAppointments.length)}</span> مواعيد
            {" · "}
            فاتك <span style={{ ...ZAIN, fontWeight: 800, color: MOBILE_COLORS.rose }}>{toArabicDigits(missedAll.length)}</span>
          </div>
        </div>
        <Link
          href="/m/notifications" aria-label="الإشعارات"
          className="m-press relative flex flex-none items-center justify-center"
          style={{ boxSizing: "border-box", width: 44, height: 44, borderRadius: 13, background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textSecondary }}
        >
          <Bell size={19} aria-hidden />
          {unread > 0 && (
            <span className="absolute flex items-center justify-center" style={{ boxSizing: "border-box", top: 5, left: 5, minWidth: 17, height: 17, borderRadius: 9, background: MOBILE_COLORS.rose, color: MOBILE_COLORS.bg, fontSize: 9, fontWeight: 700, padding: "0 4px" }}>
              {toArabicDigits(unread > 99 ? 99 : unread)}
            </span>
          )}
        </Link>
      </header>

      {/* ===== الملخص الثلاثي — يضغط فينقل للتبويب ===== */}
      <div className="grid grid-cols-3" style={{ gap: 8 }}>
        {summary.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setTab(s.key)}
            className="m-press flex flex-col items-center justify-center"
            style={{
              boxSizing: "border-box", minHeight: 74, gap: 3, borderRadius: 14,
              background: tab === s.key ? s.bg : MOBILE_COLORS.card,
              border: `1px solid ${tab === s.key ? s.border : MOBILE_COLORS.border}`,
            }}
          >
            <span style={{ ...ZAIN, fontSize: 26, fontWeight: 800, lineHeight: 1, color: s.base }}>{toArabicDigits(s.n)}</span>
            <span style={{ fontSize: 11.5, color: MOBILE_COLORS.textSecondary }}>{s.label}</span>
          </button>
        ))}
      </div>

      {/* ===== التبويبات ===== */}
      <div className="m-noscroll flex overflow-x-auto" style={{ gap: 7 }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className="m-press flex-none" style={{ paddingBlock: 4, border: "none", background: "none" }}>
            <span style={chipStyle(tab === t.key)}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ===== الفلتران (يتراكبان) ===== */}
      {tab !== "log" && (
        <div className="flex flex-col" style={{ gap: 7 }}>
          <div className="m-noscroll flex overflow-x-auto" style={{ gap: 6 }}>
            {KIND_CHIPS.map((c) => (
              <button key={c.key} type="button" onClick={() => setKind(c.key)} className="m-press flex-none" style={{ border: "none", background: "none", padding: 0 }}>
                <span style={chipStyle(kind === c.key)}>{c.label}</span>
              </button>
            ))}
          </div>
          <div className="m-noscroll flex overflow-x-auto" style={{ gap: 6 }}>
            {RANGE_CHIPS.map((c) => (
              <button key={c.key} type="button" onClick={() => pickRange(c.key)} className="m-press flex-none" style={{ border: "none", background: "none", padding: 0 }}>
                <span style={chipStyle(range === c.key, MOBILE_COLORS.sky, MOBILE_COLORS.skyBg)}>{c.label}</span>
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="flex" style={{ gap: 8 }}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                style={{ boxSizing: "border-box", flex: 1, minHeight: 42, background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 10, padding: "0 11px", fontSize: 13, color: MOBILE_COLORS.textPrimary, outline: "none" }} />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                style={{ boxSizing: "border-box", flex: 1, minHeight: 42, background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 10, padding: "0 11px", fontSize: 13, color: MOBILE_COLORS.textPrimary, outline: "none" }} />
            </div>
          )}
        </div>
      )}

      {/* ===== المحتوى ===== */}
      {tab === "today" && (
        <div className="flex flex-col" style={{ gap: 9 }}>
          {todayAppointments.filter(kindOk).length === 0 ? (
            <EmptyCard text="ما عندك مواعيد اليوم 🎉" />
          ) : (
            [...todayAppointments]
              .filter(kindOk)
              .sort((a, b) => {
                const am = a.at.getTime() < nowMs ? 0 : 1;
                const bm = b.at.getTime() < nowMs ? 0 : 1;
                return am - bm || a.at.getTime() - b.at.getTime(); // الفايتة أول القائمة
              })
              .map((a) => (
                <AppointmentCard key={`${a.leadId}-${a.kind}`} a={a} showMissedLine cta="✓ تمّت — سجّل النتيجة" />
              ))
          )}
        </div>
      )}

      {tab === "missed" && (
        <div className="flex flex-col" style={{ gap: 9 }}>
          {missedAll.filter(kindOk).length === 0 ? (
            <EmptyCard text="ما عليك شي فايت 👏" />
          ) : (
            missedAll.filter(kindOk).map((a) => (
              <AppointmentCard key={`${a.leadId}-${a.kind}-${a.at.getTime()}`} a={a} showMissedLine cta="🔄 تواصلت — سجّل النتيجة وحدّد موعدًا" />
            ))
          )}
        </div>
      )}

      {tab === "upcoming" && (
        <div className="flex flex-col" style={{ gap: 12 }}>
          {upcomingGroups.length === 0 ? (
            <EmptyCard text="ما فيه مواعيد قادمة بهذا الفلتر" />
          ) : (
            upcomingGroups.map((g) => (
              <section key={g.title} className="flex flex-col" style={{ gap: 8 }}>
                <h2 style={{ fontSize: 12.5, fontWeight: 700, color: MOBILE_COLORS.textMuted, padding: "0 2px" }}>
                  {g.title} · {toArabicDigits(g.items.length)}
                </h2>
                {g.items.map((a) => (
                  <AppointmentCard key={`${a.leadId}-${a.kind}-${a.at.getTime()}`} a={a} showMissedLine={false} cta={null} />
                ))}
              </section>
            ))
          )}
        </div>
      )}

      {tab === "log" && (
        <div className="flex flex-col" style={{ gap: 9 }}>
          {log.length === 0 ? (
            <EmptyCard text="ما سجّلت متابعات بعد" />
          ) : (
            <>
              {log.slice(0, logShown).map((r) => {
                const left = editMinutesLeft(r.createdAt, nowMs);
                return (
                  <div key={r.id} style={{ boxSizing: "border-box", background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 14, padding: "11px 13px" }}>
                    <div className="flex items-center" style={{ gap: 8 }}>
                      <span className="flex-none" style={{ width: 8, height: 8, borderRadius: 5, background: logTone(r.result), boxShadow: `0 0 9px ${logTone(r.result)}` }} />
                      <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13.5, color: MOBILE_COLORS.textSecondary }}>
                        <span style={{ fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>{r.leadName}</span>
                        {" — "}{followUpResultLabels[r.result]}
                      </span>
                      <span className="flex-none whitespace-nowrap" style={{ fontSize: 10.5, color: MOBILE_COLORS.textMuted }}>
                        قبل {elapsedLabel(r.createdAt, now)}
                      </span>
                      <Link href={`/m/leads/${r.leadId}`} aria-label={`ملف العميل ${r.leadName}`} className="m-press flex flex-none items-center justify-center"
                        style={{ boxSizing: "border-box", width: 34, height: 32, borderRadius: 9, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textSecondary, fontSize: 13 }}>
                        ←
                      </Link>
                    </div>
                    {r.note && (
                      <div style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginTop: 6, lineHeight: 1.6 }}>{r.note}</div>
                    )}
                    <div className="flex items-center" style={{ gap: 7, marginTop: 7 }}>
                      {r.nextDate && r.nextDate.getTime() > nowMs && (
                        <span style={{ boxSizing: "border-box", borderRadius: 8, padding: "3px 9px", fontSize: 11, fontWeight: 600, background: MOBILE_COLORS.skyBg, color: MOBILE_COLORS.sky }}>
                          🗓️ الموعد القادم: {fmtClock(r.nextDate)}{" "}
                          {new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", timeZone: RIYADH_TZ, day: "numeric", month: "short" }).format(r.nextDate)}
                        </span>
                      )}
                      {left > 0 && (
                        <button
                          type="button"
                          onClick={() => setEditItem(r)}
                          className="m-press"
                          style={{ boxSizing: "border-box", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }}
                        >
                          ✎ تعديل — متاح {toArabicDigits(left)} د
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {logShown < log.length && (
                <button type="button" onClick={() => setLogShown((n) => n + 10)} className="m-press"
                  style={{ boxSizing: "border-box", minHeight: 44, borderRadius: 13, border: `1px dashed ${MOBILE_COLORS.border}`, background: "none", color: MOBILE_COLORS.textSecondary, fontSize: 13, fontWeight: 600 }}>
                  عرض المزيد ({toArabicDigits(log.length - logShown)})
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ورقة تسجيل النتيجة — القائمة، معبّأة بالعميل المختار */}
      {fuSheet && (
        <FollowupSheet
          open
          onClose={() => setFuSheet(null)}
          leadId={fuSheet.leadId}
          leadName={fuSheet.name}
          phone={fuSheet.phone}
          stage={fuSheet.stage}
          firstContact={fuSheet.firstContact}
          projects={projects}
        />
      )}
      {/* ورقة تعديل المتابعة — PATCH القائم */}
      {editItem && (
        <EditFollowupSheet
          open
          onClose={() => setEditItem(null)}
          leadId={editItem.leadId}
          followupId={editItem.id}
          initialNote={editItem.note}
          initialDate={editItem.nextDate}
          createdAt={editItem.createdAt}
        />
      )}
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        boxSizing: "border-box", minHeight: 84, borderRadius: 15,
        background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
        fontSize: 13, color: MOBILE_COLORS.textSecondary,
      }}
    >
      {text}
    </div>
  );
}

export default FollowupsScreen;
