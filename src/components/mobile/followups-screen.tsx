"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CalendarDays, ListChecks, MapPin, MessageCircle, Pencil, Phone, Sparkles, UserRound } from "lucide-react";
import type { LeadStage, FollowUpResult } from "@prisma/client";
import { MOBILE_COLORS, SOP } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel } from "@/lib/mobile-format";
import { formatTime, RIYADH_TZ } from "@/lib/format";
import { DAY_MS, dayStartKSA, ksaDayKey, ksaDayOfWeek, parseRiyadhLocal } from "@/lib/ksa-time";
import { followUpResultLabels, stageLabel } from "@/lib/labels";
import { stageChipClass } from "@/lib/stage-colors";
import { waPhone } from "@/lib/value-normalize";
import { markCall } from "@/lib/mobile-call-tracker";
import { EditFollowupSheet, editMinutesLeft } from "@/components/mobile/edit-followup-sheet";

/**
 * شاشة «متابعاتي» v4 — «أوبسيديان ناعم Pro» (إعادة تنسيق، لا تغيير منطق):
 * هيدر لاصق (sticky في التدفّق الطبيعي — لا absolute) فيه سطر النوع + زر «اليوم»
 * + صف الوقت (غدًا · خلال أسبوع · مخصص · فائتة) + تبويب «السجل» منفصل،
 * وتحته حلقة إنجاز (أنجزت/متأخر/باقي). الكروت بأزرار اتصال · واتساب · الملف فقط —
 * تسجيل النتيجة صار من داخل ملف العميل (لا مُطلق لورقة المتابعة هنا).
 * كل البيانات props من الخادم، والتعديل عبر ورقة التعديل القائمة (PATCH القائم).
 * الحالات الزمنية بمؤقّت ٣٠ ثانية (cleanup) — نفس إيقاع الرئيسية.
 */

const MIN = 60_000;
const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)", fontVariantNumeric: "tabular-nums" as const };
/** ارتفاع أزرار الفعل في الكروت (المرجع البصري: ٤٦px). */
const BTN_H = 46;

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
  /** رقم العميل — زر الاتصال يبقى على الكرت المنجز في تبويب «اليوم». */
  leadPhone: string;
  result: FollowUpResult;
  note: string | null;
  nextDate: Date | null;
  createdAt: Date;
};

type TabKey = "today" | "missed" | "upcoming" | "log";
type KindKey = "all" | "fu" | "visit";
/** «خلال أسبوع» يشمل ما كان «الأسبوع الجاي» (قرار ٢٠٢٦-٠٨-٢٢) — فلا مفتاح next. */
type RangeKey = "all" | "custom" | "tomorrow" | "week";

/** سطر النوع: الكل ذهبي · زيارات أزرق · موعد لاحق تركوازي. */
const KIND_CHIPS: { key: KindKey; label: string; color: string }[] = [
  { key: "all", label: "الكل", color: SOP.gold },
  { key: "visit", label: "زيارات", color: SOP.blue },
  { key: "fu", label: "موعد لاحق", color: SOP.teal },
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
/**
 * لون النوع (يتبع النوع لا الحالة): متابعة اتصال ذهبي (gold2) · زيارة أزرق · أول تواصل تركوازي.
 * الخلفية الخافتة بـcolor-mix من لون النوع نفسه (تتبع الوضع تلقائيًا).
 */
function kindTone(kind: FuAppointment["kind"]): { base: string; bg: string } {
  const base = kind === "visit" ? SOP.blue : kind === "new" ? SOP.teal : SOP.gold2;
  return { base, bg: `color-mix(in srgb, ${base} 14%, transparent)` };
}
/** خلفية صندوق الملاحظة: مسحة خفيفة من لون النص (لا أسود قوي) — تتبع الوضع. */
const NOTE_BG = `color-mix(in srgb, ${SOP.tx} 5%, transparent)`;
function kindLabel(kind: FuAppointment["kind"]): string {
  return kind === "visit" ? "زيارة" : kind === "new" ? "أول تواصل" : "موعد لاحق";
}
function KindIcon({ kind, size = 18 }: { kind: FuAppointment["kind"]; size?: number }) {
  if (kind === "visit") return <MapPin size={size} strokeWidth={1.8} aria-hidden />;
  if (kind === "new") return <Sparkles size={size} strokeWidth={1.8} aria-hidden />;
  return <Phone size={size} strokeWidth={1.8} aria-hidden />;
}
function logTone(result: FollowUpResult): string {
  if (result.startsWith("NOT_INTERESTED")) return SOP.red;
  if (result.startsWith("NOT_ANSWERED") || result === "NO_ANSWER_INTERESTED" || result === "CALL_LATER") return SOP.blue;
  if (result === "NEGOTIATING" || result === "BANK_CHECK" || result === "ON_HOLD") return SOP.amber;
  return SOP.green;
}

/** شريحة الفلتر — مفعّلة: خلفية خافتة بلونها + حد بلونها · خاملة: سطح بارز. */
const chipStyle = (on: boolean, color: string = SOP.gold, bg: string = MOBILE_COLORS.goldBg) => ({
  boxSizing: "border-box" as const, minHeight: 38, padding: "0 12px", borderRadius: 12,
  fontSize: 12.5, fontWeight: 700 as const,
  border: `1px solid ${on ? color : SOP.edge}`,
  ...(on
    ? { background: bg, color }
    : { background: SOP.plane, color: SOP.tx2 }),
});

/**
 * أزرار الفعل في الكروت — مطابقة followups-fixed2 حرفيًا (تُعمَّم لاحقًا على كرت العميل
 * وكرت الموعد القادم): ٤٦px · radius 12 · 600/12.5 · gap 7 · أيقونة ١٧px stroke 2.
 *  gold: «اتصال» الأساسي — تدرّج ذهبي، نص/أيقونة --sop-ongold.
 *  wa:   «واتساب» — مزيج أخضر ١٦٪ فوق السطح، نص/أيقونة --sop-green.
 *  file: «الملف» — سطح بارز نيومورفيزمي بحد ذهبي رفيع، نص/أيقونة --sop-gold2.
 */
const actionBtn = (tone: "gold" | "wa" | "file") => ({
  boxSizing: "border-box" as const, height: BTN_H, borderRadius: 12, fontSize: 12.5, fontWeight: 600 as const, gap: 7, border: "none",
  ...(tone === "gold"
    ? { background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold }
    : tone === "wa"
      ? { background: `color-mix(in srgb, ${SOP.green} 16%, ${SOP.plane})`, color: SOP.green }
      : {
          background: SOP.plane, color: SOP.gold2,
          boxShadow: `3px 3px 7px ${SOP.sd}, -3px -3px 7px ${SOP.sl}`,
          border: `1px solid color-mix(in srgb, ${SOP.gold} 18%, transparent)`,
        }),
});
/** أيقونة زر الفعل — ١٧px بسماكة ٢ (تحت سقف ٢٨px). */
const BTN_ICON = { size: 17, strokeWidth: 2 } as const;

export function FollowupsScreen({
  todayAppointments, doneToday, missedOld, upcoming, log, unread, projects, initialTab,
}: {
  /** مواعيد اليوم كاملة (بما فيها الفائتة اليوم) — من buildAgenda/buildDayAppointments. */
  todayAppointments: FuAppointment[];
  /** منجزات اليوم (متابعة لكل عميل) — تبقى في تبويب «اليوم» بمظهر مكتمل حتى نهايته. */
  doneToday: FuLogItem[];
  /** الفائت من الأيام السابقة (متابعات متأخرة + زيارات معلّقة قديمة). */
  missedOld: FuAppointment[];
  /** المواعيد المستقبلية (بعد اليوم) — تُجمَّع بالأيام هنا. */
  upcoming: FuAppointment[];
  /** سجل منجزاته (حتى ٤٠ — «عرض المزيد» محلي). */
  log: FuLogItem[];
  unread: number;
  /** تبقى بالعقد (الصفحة تمرّرها) — تسجيل النتيجة انتقل لملف العميل فلا تُستهلك هنا. */
  projects: { id: string; name: string }[];
  initialTab?: string;
}) {
  void projects;
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
  const goToday = () => { setTab("today"); setRange("all"); };

  const upcomingFiltered = useMemo(() => {
    // كل الحدود بيوم الرياض (بداية اليوم ويوم الأسبوع) — لا توقيت الجهاز.
    const dayMs = DAY_MS;
    const t0 = dayStartKSA(now).getTime();
    const dow = ksaDayOfWeek(now);
    let lo = -Infinity, hi = Infinity;
    if (range === "tomorrow") { lo = t0 + dayMs; hi = t0 + 2 * dayMs; }
    else if (range === "week") {
      // «خلال أسبوع» = بقية هذا الأسبوع + الأسبوع الجاي كاملًا (دمج «الأسبوع الجاي» فيه).
      const endThisWeek = t0 + (7 - (dow % 7 === 0 ? 7 : dow % 7)) * dayMs + dayMs;
      lo = t0; hi = endThisWeek + 7 * dayMs;
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

  // حلقة الإنجاز: أنجزت = منجزات اليوم · متأخر = فات وقته ولم تُسجَّل لعميله متابعة اليوم ·
  // باقي = لم يحن وقته ولم يُنجَز. (doneToday متابعة واحدة لكل عميل — نفس مصدر الرئيسية.)
  const doneN = doneToday.length;
  const doneIds = new Set(doneToday.map((d) => d.leadId));
  const lateN = todayAppointments.filter((a) => a.at.getTime() < nowMs && !doneIds.has(a.leadId)).length;
  const leftN = todayAppointments.filter((a) => a.at.getTime() >= nowMs && !doneIds.has(a.leadId)).length;
  const todayTotal = doneN + lateN + leftN;
  const donePct = todayTotal > 0 ? doneN / todayTotal : 0;

  const timeRow: { key: "tomorrow" | "week" | "custom" | "missed"; label: string; color: string; bg: string; on: boolean; go: () => void }[] = [
    { key: "tomorrow", label: "غدًا", color: SOP.gold, bg: MOBILE_COLORS.goldBg, on: tab === "upcoming" && range === "tomorrow", go: () => pickRange("tomorrow") },
    { key: "week", label: "خلال أسبوع", color: SOP.gold, bg: MOBILE_COLORS.goldBg, on: tab === "upcoming" && range === "week", go: () => pickRange("week") },
    { key: "custom", label: "مخصص", color: SOP.gold, bg: MOBILE_COLORS.goldBg, on: tab === "upcoming" && range === "custom", go: () => pickRange("custom") },
    { key: "missed", label: "فائتة", color: SOP.red, bg: MOBILE_COLORS.roseBg, on: tab === "missed", go: () => setTab("missed") },
  ];

  /** كرت موعد — صف علوي (أيقونة النوع · الاسم والجوال · الوقت) + شارتان + ملاحظة + ٣ أزرار. */
  const AppointmentCard = ({ a, showMissedLine }: { a: FuAppointment; showMissedLine: boolean }) => {
    const missed = a.at.getTime() < nowMs;
    const soon = !missed && a.at.getTime() - nowMs <= 60 * MIN;
    const tone = kindTone(a.kind);
    // الخط الجانبي وحده يتبع الحالة (فاتت = أحمر)؛ الأيقونة والوقت وشارة النوع تتبع النوع.
    const lineColor = missed ? SOP.red : tone.base;
    return (
      <div className="m-raise relative overflow-hidden" style={{ boxSizing: "border-box", borderRadius: 16, padding: "12px 14px 12px 12px" }}>
        <span aria-hidden style={{ position: "absolute", insetInlineStart: 0, top: 10, bottom: 10, width: 4, borderRadius: "0 3px 3px 0", background: lineColor }} />
        {/* الصف العلوي */}
        <div className="flex items-center" style={{ gap: 10 }}>
          <span
            className="flex flex-none items-center justify-center"
            style={{ boxSizing: "border-box", width: 36, height: 36, borderRadius: 11, background: tone.bg, color: tone.base }}
            aria-hidden
          >
            <KindIcon kind={a.kind} />
          </span>
          <div className="min-w-0 flex-1">
            <Link href={`/m/leads/${a.leadId}`} className="block min-w-0 truncate" style={{ fontSize: 15, fontWeight: 700, color: SOP.tx }}>
              {a.name}
            </Link>
            <div dir="ltr" className="truncate" style={{ ...ZAIN, fontSize: 11.5, color: SOP.mut, marginTop: 2, textAlign: "end" }}>
              {a.phone}
            </div>
          </div>
          <div className="flex-none text-center" style={{ boxSizing: "border-box", borderRadius: 10, padding: "6px 9px", background: tone.bg }}>
            <div style={{ ...ZAIN, fontSize: 15, fontWeight: 800, lineHeight: 1, color: tone.base }}>{fmtClock(a.at)}</div>
          </div>
        </div>
        {/* الشارتان: النوع + المرحلة (+ فاتت/الآن) */}
        <div className="flex flex-wrap items-center" style={{ gap: 6, marginTop: 9 }}>
          <span style={{ boxSizing: "border-box", borderRadius: 7, padding: "3px 8px", fontSize: 10.5, fontWeight: 700, background: tone.bg, color: tone.base }}>
            {kindLabel(a.kind)}
          </span>
          <span className={`border font-semibold ${stageChipClass[a.stage]}`} style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 7 }}>
            {stageLabel(a.stage)}
          </span>
          {missed && (
            <span style={{ boxSizing: "border-box", borderRadius: 7, padding: "3px 8px", fontSize: 10.5, fontWeight: 700, background: MOBILE_COLORS.roseBg, color: SOP.red }}>فاتت</span>
          )}
          {soon && (
            <span style={{ boxSizing: "border-box", borderRadius: 7, padding: "3px 8px", fontSize: 10.5, fontWeight: 700, background: MOBILE_COLORS.amberBg, color: SOP.amber }}>الآن</span>
          )}
        </div>
        {/* صندوق الملاحظة/السبب */}
        <div className="m-inset" style={{ boxSizing: "border-box", background: NOTE_BG, borderInlineStart: `2px solid ${SOP.edge2}`, borderRadius: 11, padding: "8px 11px", marginTop: 9, fontSize: 12, lineHeight: 1.65, color: SOP.tx2 }}>
          {a.reason}
          {showMissedLine && missed && (
            <div style={{ fontSize: 11.5, fontWeight: 700, color: SOP.red, marginTop: 3 }}>
              فات من {minsOrHours(nowMs - a.at.getTime())}
            </div>
          )}
        </div>
        {/* أزرار الفعل — اتصال · واتساب · الملف (لا «سجّل النتيجة» — من ملف العميل) */}
        <div className="flex" style={{ gap: 8, marginTop: 10 }}>
          <a href={`tel:${a.phone}`} onClick={() => markCall(a.leadId)} className="m-press-sc flex items-center justify-center" style={{ ...actionBtn("gold"), flex: 1.3 }}>
            <Phone {...BTN_ICON} aria-hidden /> اتصال
          </a>
          <a href={`https://wa.me/${waPhone(a.phone)}`} target="_blank" rel="noopener noreferrer" className="m-press-sc flex items-center justify-center" style={{ ...actionBtn("wa"), flex: 1 }}>
            <MessageCircle {...BTN_ICON} aria-hidden /> واتساب
          </a>
          <Link href={`/m/leads/${a.leadId}`} aria-label={`ملف العميل ${a.name}`} className="m-press-sc flex items-center justify-center" style={{ ...actionBtn("file"), flex: 1 }}>
            <UserRound {...BTN_ICON} aria-hidden /> الملف
          </Link>
        </div>
      </div>
    );
  };

  /** كرت منجز اليوم — يبقى حتى نهاية اليوم بمظهر مكتمل: علامة خضراء، شطب خفيف،
      النتيجة سطرًا واحدًا، وأزرار اتصال · الملف · تعديل (ضمن نافذة الساعة). */
  const DoneCard = ({ r }: { r: FuLogItem }) => {
    const left = editMinutesLeft(r.createdAt, nowMs);
    return (
      <div className="m-raise relative overflow-hidden" style={{ boxSizing: "border-box", borderRadius: 16, padding: "12px 14px 12px 12px" }}>
        <span aria-hidden style={{ position: "absolute", insetInlineStart: 0, top: 10, bottom: 10, width: 4, borderRadius: "0 3px 3px 0", background: SOP.green }} />
        <div className="flex items-center" style={{ gap: 10 }}>
          <span className="flex flex-none items-center justify-center" style={{ boxSizing: "border-box", width: 38, height: 38, borderRadius: 11, background: MOBILE_COLORS.mintBg, color: SOP.green }} aria-hidden>
            <ListChecks size={18} strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              href={`/m/leads/${r.leadId}`}
              className="block min-w-0 truncate"
              style={{ fontSize: 15, fontWeight: 700, color: SOP.tx2, textDecoration: "line-through", textDecorationColor: SOP.mut, textDecorationThickness: 1 }}
            >
              {r.leadName}
            </Link>
            <div className="truncate" style={{ fontSize: 12, color: SOP.green, marginTop: 3 }}>
              {followUpResultLabels[r.result]}{r.note ? ` — ${r.note}` : ""}
            </div>
          </div>
          <div className="flex-none text-center" style={{ boxSizing: "border-box", borderRadius: 10, padding: "6px 9px", background: MOBILE_COLORS.mintBg }}>
            <div style={{ ...ZAIN, fontSize: 13, fontWeight: 800, lineHeight: 1, color: SOP.green }}>{fmtClock(r.createdAt)}</div>
          </div>
        </div>
        <div className="flex" style={{ gap: 8, marginTop: 10 }}>
          {/* المنجز: الاتصال ثانوي (سطح بارز بلون النص) — الأساسي الذهبي محجوز لغير المنجز. */}
          <a href={`tel:${r.leadPhone}`} onClick={() => markCall(r.leadId)} className="m-press-sc flex flex-1 items-center justify-center" style={{ ...actionBtn("file"), color: SOP.tx2, border: `1px solid ${SOP.edge}` }}>
            <Phone {...BTN_ICON} aria-hidden /> اتصال
          </a>
          <Link href={`/m/leads/${r.leadId}`} aria-label={`ملف العميل ${r.leadName}`} className="m-press-sc flex flex-1 items-center justify-center" style={actionBtn("file")}>
            <UserRound {...BTN_ICON} aria-hidden /> الملف
          </Link>
          {left > 0 && (
            <button type="button" onClick={() => setEditItem(r)} className="m-press-sc flex items-center justify-center" style={{ ...actionBtn("wa"), flex: 1.3, background: `color-mix(in srgb, ${SOP.gold} 16%, ${SOP.plane})`, color: SOP.gold2 }}>
              <Pencil {...BTN_ICON} aria-hidden /> تعديل · {toArabicDigits(left)} د
            </button>
          )}
        </div>
      </div>
    );
  };

  const inputStyle = {
    boxSizing: "border-box" as const, flex: 1, minHeight: 42, background: SOP.page, border: `1px solid ${SOP.edge}`,
    borderRadius: 11, padding: "0 11px", fontSize: 13, color: SOP.tx, outline: "none",
  };

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      {/*
        ===== الهيدر اللاصق =====
        sticky (top:0) داخل التدفّق الطبيعي — لا absolute، فلا يغطّي شيئًا: يحجز ارتفاعه
        في العمود ويلتصق عند التمرير. الهوامش السالبة تلغي حشوة القشرة (١٨px جانبًا +
        safe-area+١٨ علويًا) ثم تُعاد حشوة داخلية — نفس نمط DiwanTopbar.
      */}
      <div
        className="sticky flex flex-col"
        style={{
          zIndex: 40,
          top: 0,
          gap: 9,
          margin: "calc(-1 * (env(safe-area-inset-top) + 18px)) -18px 0",
          padding: "calc(env(safe-area-inset-top) + 12px) 18px 12px",
          background: MOBILE_COLORS.navBg,
          backdropFilter: "blur(20px) saturate(1.15)",
          WebkitBackdropFilter: "blur(20px) saturate(1.15)",
          borderBottom: `1px solid ${SOP.edge}`,
        }}
      >
        {/* العنوان + الجرس */}
        <header className="flex items-center justify-between" style={{ gap: 10 }}>
          <div className="min-w-0">
            <h1 style={{ fontSize: 21, fontWeight: 800, color: SOP.tx, lineHeight: 1.15 }}>متابعاتي</h1>
            <div style={{ fontSize: 12, color: SOP.tx2, marginTop: 3 }}>
              اليوم <span style={{ ...ZAIN, fontWeight: 800, color: SOP.gold }}>{toArabicDigits(todayTotal)}</span> مواعيد
              {doneN > 0 && <> — أنجزت <span style={{ ...ZAIN, fontWeight: 800, color: SOP.green }}>{toArabicDigits(doneN)}</span></>}
              {" · "}
              فاتك <span style={{ ...ZAIN, fontWeight: 800, color: SOP.red }}>{toArabicDigits(missedAll.length)}</span>
            </div>
          </div>
          <Link
            href="/m/notifications" aria-label="الإشعارات"
            className="m-raise m-press-sc relative flex flex-none items-center justify-center"
            style={{ boxSizing: "border-box", width: 42, height: 42, borderRadius: 13, color: SOP.tx2 }}
          >
            <Bell size={18} strokeWidth={1.8} aria-hidden />
            {unread > 0 && (
              <span className="absolute flex items-center justify-center" style={{ ...ZAIN, boxSizing: "border-box", top: 4, left: 4, minWidth: 17, height: 17, borderRadius: 9, background: SOP.red, color: SOP.tx, fontSize: 9.5, fontWeight: 700, padding: "0 4px" }}>
                {toArabicDigits(unread > 99 ? 99 : unread)}
              </span>
            )}
          </Link>
        </header>

        {/* سطر النوع — ثلاثة أزرار متساوية */}
        <div className="grid grid-cols-3" style={{ gap: 7 }}>
          {KIND_CHIPS.map((c) => (
            <button key={c.key} type="button" onClick={() => setKind(c.key)} className="m-press-sc" style={chipStyle(kind === c.key, c.color, `color-mix(in srgb, ${c.color} 14%, transparent)`)}>
              {c.label}
            </button>
          ))}
        </div>

        {/* زر «اليوم» — عرض كامل بارز بعدّاد */}
        <button
          type="button"
          onClick={goToday}
          className={`${tab === "today" ? "" : "m-raise"} m-press-sc flex w-full items-center justify-between`}
          style={{
            boxSizing: "border-box", minHeight: 46, borderRadius: 14, padding: "0 14px", fontSize: 14, fontWeight: 800,
            ...(tab === "today"
              ? { background: SOP.gold, color: SOP.onGold, border: "none" }
              : { color: SOP.tx }),
          }}
        >
          <span>اليوم</span>
          <span style={{ ...ZAIN, fontSize: 15, fontWeight: 800 }}>{toArabicDigits(todayTotal)}</span>
        </button>

        {/* صف الوقت: غدًا · خلال أسبوع · مخصص · فائتة */}
        <div className="grid grid-cols-4" style={{ gap: 7 }}>
          {timeRow.map((c) => (
            <button key={c.key} type="button" onClick={c.go} className="m-press-sc flex items-center justify-center" style={{ ...chipStyle(c.on, c.color, c.bg), gap: 5, padding: "0 6px" }}>
              {c.key === "custom" && <CalendarDays size={14} strokeWidth={2} aria-hidden />}
              {c.label}
            </button>
          ))}
        </div>
        {tab === "upcoming" && range === "custom" && (
          <div className="flex" style={{ gap: 8 }}>
            <input type="date" aria-label="من تاريخ" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
            <input type="date" aria-label="إلى تاريخ" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
          </div>
        )}

        {/* تبويب «السجل» — منفصل وواضح */}
        <button
          type="button"
          onClick={() => setTab("log")}
          className={`${tab === "log" ? "m-inset" : ""} m-press-sc flex w-full items-center justify-center`}
          style={{
            boxSizing: "border-box", minHeight: 38, borderRadius: 12, gap: 7, fontSize: 12.5, fontWeight: 700,
            ...(tab === "log" ? { color: SOP.gold } : { background: "transparent", border: `1px dashed ${SOP.edge2}`, color: SOP.tx2 }),
          }}
        >
          <ListChecks size={15} strokeWidth={2} aria-hidden />
          السجل · <span style={ZAIN}>{toArabicDigits(log.length)}</span> متابعة
        </button>
      </div>

      {/* ===== حلقة الإنجاز ===== */}
      {tab !== "log" && (
        <div className="m-raise flex items-center" style={{ boxSizing: "border-box", borderRadius: 18, padding: "13px 15px", gap: 14 }}>
          <div className="relative flex-none" style={{ width: 64, height: 64 }}>
            {/* حلقة ثابتة (لا حركة) — تحترم prefers-reduced-motion بطبيعتها. */}
            <svg data-svg-free viewBox="0 0 64 64" width={64} height={64} style={{ transform: "rotate(-90deg)" }} aria-hidden>
              <circle cx={32} cy={32} r={26} fill="none" stroke={SOP.edge2} strokeWidth={6} />
              <circle
                cx={32} cy={32} r={26} fill="none" stroke={SOP.green} strokeWidth={6} strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 26}
                strokeDashoffset={2 * Math.PI * 26 * (1 - donePct)}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center" style={{ ...ZAIN, fontSize: 14, fontWeight: 800, color: SOP.tx }}>
              {toArabicDigits(Math.round(donePct * 100))}٪
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center" style={{ gap: 14 }}>
              {[
                { n: doneN, label: "أنجزت", color: SOP.green },
                { n: lateN, label: "متأخر", color: SOP.red },
                { n: leftN, label: "باقي", color: SOP.gold },
              ].map((s) => (
                <div key={s.label} className="flex flex-col items-center" style={{ minWidth: 44 }}>
                  <span style={{ ...ZAIN, fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: s.color }}>{toArabicDigits(s.n)}</span>
                  <span style={{ fontSize: 10.5, color: SOP.mut, marginTop: 2 }}>{s.label}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: SOP.tx2, marginTop: 6 }}>
              أنجزت <span style={{ ...ZAIN, fontWeight: 700, color: SOP.green }}>{toArabicDigits(doneN)}</span> من <span style={{ ...ZAIN, fontWeight: 700, color: SOP.tx }}>{toArabicDigits(todayTotal)}</span> اليوم
            </div>
          </div>
        </div>
      )}

      {/* ===== المحتوى ===== */}
      {tab === "today" && (
        <div className="flex flex-col" style={{ gap: 9 }}>
          {/* المستحق والفائت أولًا — والمنجز يبقى أسفل القائمة حتى نهاية اليوم */}
          {todayAppointments.filter(kindOk).length === 0 ? (
            <EmptyCard text={doneToday.length > 0 ? "خلّصت مواعيد اليوم كلها" : "ما عندك مواعيد اليوم"} />
          ) : (
            [...todayAppointments]
              .filter(kindOk)
              .sort((a, b) => {
                const am = a.at.getTime() < nowMs ? 0 : 1;
                const bm = b.at.getTime() < nowMs ? 0 : 1;
                return am - bm || a.at.getTime() - b.at.getTime(); // الفايتة أول القائمة
              })
              .map((a) => (
                <AppointmentCard key={`${a.leadId}-${a.kind}`} a={a} showMissedLine />
              ))
          )}
          {doneToday.length > 0 && (
            <>
              <h2 className="flex items-center" style={{ gap: 6, fontSize: 12.5, fontWeight: 700, color: SOP.green, padding: "4px 2px 0" }}>
                <ListChecks size={14} strokeWidth={2} aria-hidden /> أنجزت اليوم · <span style={ZAIN}>{toArabicDigits(doneToday.length)}</span>
              </h2>
              {doneToday.map((r) => <DoneCard key={r.id} r={r} />)}
            </>
          )}
        </div>
      )}

      {tab === "missed" && (
        <div className="flex flex-col" style={{ gap: 9 }}>
          {missedAll.filter(kindOk).length === 0 ? (
            <EmptyCard text="ما عليك شي فايت" />
          ) : (
            missedAll.filter(kindOk).map((a) => (
              <AppointmentCard key={`${a.leadId}-${a.kind}-${a.at.getTime()}`} a={a} showMissedLine />
            ))
          )}
        </div>
      )}

      {tab === "upcoming" && (
        <div className="flex flex-col" style={{ gap: 12 }}>
          <h2 style={{ fontSize: 12.5, fontWeight: 700, color: SOP.mut, padding: "0 2px" }}>
            {range === "tomorrow" ? "غدًا" : range === "week" ? "خلال أسبوع" : range === "custom" ? "نطاق مخصص" : "القادمة"} · <span style={ZAIN}>{toArabicDigits(upcomingFiltered.length)}</span>
          </h2>
          {upcomingGroups.length === 0 ? (
            <EmptyCard text="ما فيه مواعيد قادمة بهذا الفلتر" />
          ) : (
            upcomingGroups.map((g) => (
              <section key={g.title} className="flex flex-col" style={{ gap: 8 }}>
                <h3 style={{ fontSize: 12, fontWeight: 700, color: SOP.tx2, padding: "0 2px" }}>
                  {g.title} · <span style={ZAIN}>{toArabicDigits(g.items.length)}</span>
                </h3>
                {g.items.map((a) => (
                  <AppointmentCard key={`${a.leadId}-${a.kind}-${a.at.getTime()}`} a={a} showMissedLine={false} />
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
                  <div key={r.id} className="m-raise" style={{ boxSizing: "border-box", borderRadius: 15, padding: "11px 13px" }}>
                    <div className="flex items-center" style={{ gap: 8 }}>
                      <span className="flex-none" style={{ width: 8, height: 8, borderRadius: 5, background: logTone(r.result), boxShadow: `0 0 9px ${logTone(r.result)}` }} />
                      <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13.5, color: SOP.tx2 }}>
                        <span style={{ fontWeight: 700, color: SOP.tx }}>{r.leadName}</span>
                        {" — "}{followUpResultLabels[r.result]}
                      </span>
                      <span className="flex-none whitespace-nowrap" style={{ fontSize: 10.5, color: SOP.mut }}>
                        قبل {elapsedLabel(r.createdAt, now)}
                      </span>
                      <Link href={`/m/leads/${r.leadId}`} aria-label={`ملف العميل ${r.leadName}`} className="m-press-sc flex flex-none items-center justify-center"
                        style={{ boxSizing: "border-box", width: 34, height: 32, borderRadius: 9, background: SOP.planeHi, border: `1px solid ${SOP.edge}`, color: SOP.tx2 }}>
                        <UserRound size={15} strokeWidth={2} aria-hidden />
                      </Link>
                    </div>
                    {r.note && (
                      <div className="m-inset" style={{ boxSizing: "border-box", background: NOTE_BG, borderInlineStart: `2px solid ${SOP.edge2}`, fontSize: 12, color: SOP.tx2, marginTop: 7, lineHeight: 1.6, borderRadius: 10, padding: "7px 10px" }}>{r.note}</div>
                    )}
                    <div className="flex items-center" style={{ gap: 7, marginTop: 7 }}>
                      {r.nextDate && r.nextDate.getTime() > nowMs && (
                        <span className="flex items-center" style={{ boxSizing: "border-box", gap: 5, borderRadius: 8, padding: "3px 9px", fontSize: 11, fontWeight: 600, background: MOBILE_COLORS.skyBg, color: SOP.blue }}>
                          <CalendarDays size={12} strokeWidth={2} aria-hidden />
                          الموعد القادم: {fmtClock(r.nextDate)}{" "}
                          {new Intl.DateTimeFormat("ar-SA-u-nu-arab", { calendar: "gregory", timeZone: RIYADH_TZ, day: "numeric", month: "short" }).format(r.nextDate)}
                        </span>
                      )}
                      {left > 0 && (
                        <button
                          type="button"
                          onClick={() => setEditItem(r)}
                          className="m-press-sc flex items-center"
                          style={{ boxSizing: "border-box", gap: 5, borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, background: MOBILE_COLORS.goldBg, color: SOP.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }}
                        >
                          <Pencil size={12} strokeWidth={2} aria-hidden /> تعديل — متاح {toArabicDigits(left)} د
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {logShown < log.length && (
                <button type="button" onClick={() => setLogShown((n) => n + 10)} className="m-press-sc"
                  style={{ boxSizing: "border-box", minHeight: 44, borderRadius: 13, border: `1px dashed ${SOP.edge2}`, background: "none", color: SOP.tx2, fontSize: 13, fontWeight: 600 }}>
                  عرض المزيد ({toArabicDigits(log.length - logShown)})
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ورقة تعديل المتابعة — PATCH القائم (ورقة التسجيل أُزيلت من هنا: تُفتح من ملف العميل) */}
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
      className="m-inset flex items-center justify-center"
      style={{ boxSizing: "border-box", minHeight: 84, borderRadius: 15, fontSize: 13, color: SOP.tx2 }}
    >
      {text}
    </div>
  );
}

export default FollowupsScreen;
