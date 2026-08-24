import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getDashboard, normalizePeriod, type Period } from "@/lib/data/dashboard";
import { getLeadCounts } from "@/lib/data/leads";
import { getNotifications } from "@/lib/actions/notifications";
import { normalizeFuWindow, FU_WINDOWS } from "@/lib/data/team-commitment";
import { getOwnerTeamFollowups, getOwnerAudit } from "@/lib/data/owner-dashboard";
import { getLiveBoard } from "@/lib/data/attendance";
import { getTeam, getTeamPresence } from "@/lib/data/team";
import { pauseReasonLabel, formatPauseRemaining } from "@/lib/availability";
import { SOP } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel, greeting } from "@/lib/mobile-format";
import { formatDate } from "@/lib/format";
import { MobileHeaderActions } from "@/components/mobile/header-actions";
import { OwnerKpis } from "@/components/mobile/owner-kpis";
import { OwnerTeamSection, type OwnerTeamRow, type OwnerTeamState } from "@/components/mobile/owner-team";
import { OwnerAuditSection, type OwnerAuditItem } from "@/components/mobile/owner-audit";
import { OwnerFunnel } from "@/components/mobile/owner-funnel";
import { AttendanceCard } from "@/components/attendance/attendance-card";

/**
 * رئيسية المالك/المدير — إعادة تصميم owner-home-final الكاملة:
 * ١) أرقام الأداء (segmented + كرت غير الموزّعين + الحبوب)
 * ٢) دوام وحالة الفريق (getLiveBoard + getTeam — حلقات نسبة الدوام والاستقبال)
 * ٣) التزام المتابعات (getOwnerTeamFollowups — الأسوأ أولًا من الخادم)
 * ٤) سجل التدقيق التفاعلي (getOwnerAudit + معاينة العميل)
 * ٥) قمع المبيعات (getDashboard.funnel بألوان STAGE_HEX)
 * ٦) نجم الأسبوع — Placeholder بانتظار اعتماد المعادلة.
 * عرض وتغليف خالص فوق الدوال القائمة — صفر منطق أعمال جديد.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)" };

// ===================== ترويسة قسم مرقّمة + شرائط الفلاتر (owner-home-final) =====================

/** ترويسة قسم بأسلوب المرجع: رقم داخل صندوق بلون القسم + العنوان + وسم/رابط يمين. */
function SecNum({ n, ac, title, cnt, cntHref }: { n: string; ac: string; title: string; cnt?: string; cntHref?: string }) {
  return (
    <div className="flex items-center" style={{ gap: 8, margin: "7px 2px 0" }}>
      <span
        className="flex flex-none items-center justify-center"
        style={{
          ...ZAIN, boxSizing: "border-box", width: 19, height: 19, borderRadius: 6,
          fontSize: 11, fontWeight: 800,
          background: `color-mix(in srgb, ${ac} 18%, transparent)`, color: ac,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 14, fontWeight: 800, color: SOP.tx }}>{title}</span>
      {cnt && (cntHref ? (
        <Link href={cntHref} style={{ marginInlineStart: "auto", fontSize: "9.5px", fontWeight: 700, color: SOP.gold2 }}>{cnt}</Link>
      ) : (
        <span style={{ marginInlineStart: "auto", fontSize: "9.5px", color: SOP.mut }}>{cnt}</span>
      ))}
    </div>
  );
}

/** بارامترات URL مشتركة لشرائط الفلاتر — القيم الفارغة والافتراضي (أول عنصر) تُسقط. */
function chipHref<T extends string>(param: string, key: T, first: T, base: string, keep?: Record<string, string>): string {
  const qp = new URLSearchParams();
  if (key !== first) qp.set(param, key);
  for (const [k, v] of Object.entries(keep ?? {})) if (v) qp.set(k, v);
  const qs = qp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * شريط الفترات المنزلق (segmented) — روابط لا أزرار، فالحالة في الرابط
 * (قابلة للمشاركة والرجوع). الحاوية غائرة (.m-inset) والفعّالة بتدرّج ذهبي.
 */
function PeriodSeg<T extends string>({
  param, current, base, items, keep,
}: {
  param: string;
  current: T;
  base: string;
  items: { key: T; label: string }[];
  keep?: Record<string, string>;
}) {
  return (
    <div className="m-inset flex" style={{ boxSizing: "border-box", padding: 4, borderRadius: 13 }}>
      {items.map((it) => {
        const on = it.key === current;
        return (
          <Link
            key={it.key}
            href={chipHref(param, it.key, items[0].key, base, keep)}
            scroll={false}
            aria-current={on ? "true" : undefined}
            className="m-press-sc flex min-w-0 flex-1 items-center justify-center whitespace-nowrap"
            style={{
              boxSizing: "border-box", minHeight: 34, padding: "8px 4px", borderRadius: 9,
              fontSize: "10.5px", fontWeight: on ? 700 : 600,
              ...(on
                ? {
                    color: SOP.onGold,
                    background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`,
                    boxShadow: `0 3px 9px color-mix(in srgb, ${SOP.gold} 32%, transparent)`,
                  }
                : { color: SOP.tx2 }),
            }}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

/** رقائق فلتر بارزة (نمط .chips في المرجع) — نفس عقد الروابط. */
function ChipsRow<T extends string>({
  param, current, base, items, keep,
}: {
  param: string;
  current: T;
  base: string;
  items: readonly { key: T; label: string }[];
  keep?: Record<string, string>;
}) {
  return (
    <div className="m-noscroll flex overflow-x-auto" style={{ gap: 7 }}>
      {items.map((it) => {
        const on = it.key === current;
        return (
          <Link
            key={it.key}
            href={chipHref(param, it.key, items[0].key, base, keep)}
            scroll={false}
            aria-current={on ? "true" : undefined}
            className={`${on ? "" : "m-raise"} m-press-sc flex flex-none items-center whitespace-nowrap`}
            style={{
              boxSizing: "border-box", padding: "8px 15px", borderRadius: 11,
              fontSize: 12, fontWeight: on ? 700 : 600,
              ...(on
                ? { color: SOP.onGold, background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, boxShadow: `0 3px 9px color-mix(in srgb, ${SOP.gold} 32%, transparent)` }
                : { color: SOP.tx2 }),
            }}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

// ===================== قسم الفريق: تجهيز الصفوف من getLiveBoard + getTeam =====================

/** «٦:١٩» — ساعات:دقائق بأرقام عربية. */
function fmtHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${toArabicDigits(h)}:${toArabicDigits(String(m).padStart(2, "0"))}`;
}

/** هدف الوردية: «٨س» للساعات الكاملة وإلا «٧:٣٠». */
function fmtTarget(mins: number): string {
  return mins % 60 === 0 ? `${toArabicDigits(mins / 60)}س` : fmtHM(mins);
}

// ===================== الصفحة =====================

export async function MobileOwnerHome({
  user,
  period: rawPeriod,
  fuWindow: rawFu,
}: {
  user: { id?: string; name?: string | null; role: string };
  period?: string;
  /** فلتر قسم «التزام المتابعات» (?fu=) — مستقل تمامًا عن فلتر الأرقام (?p=). */
  fuWindow?: string;
}) {
  const period = normalizePeriod(rawPeriod);
  const fuWin = normalizeFuWindow(rawFu);
  const owner = user.role === "OWNER";
  const now = new Date();
  const nowMs = now.getTime();

  const [data, counts, notif, presence, live, team, fu, audit] = await Promise.all([
    getDashboard(period),
    // نفس دالة شارة الزئبق حرفيًا — ومغلّفة بـcache() فالبطاقة والشارة تقرآن نتيجة الطلب الواحدة.
    getLeadCounts(),
    getNotifications(),
    getTeamPresence(),
    // اليوم الحي (بلا مدى) — نفس مصدر لوحة الدوام حرفيًا.
    getLiveBoard(),
    // حالة الاستقبال وآخر الظهور لكل الأدوار — نفس مصدر شاشة الفريق.
    getTeam(),
    // «التزام المتابعات» بفترات المالك — مرتّبة الأسوأ أولًا من الخادم.
    getOwnerTeamFollowups(fuWin),
    // آخر ٣٠ عملية بأسماء وجوالات محلولة ومعرّف عميل مؤكد — نفس مسار لوحة الويب.
    getOwnerAudit(30),
  ]);

  const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "مرحبًا";
  const onlineCount = presence.filter((p) => p.online).length;

  // ===== ٢) دوام وحالة الفريق =====
  const liveRows = live.mode === "today" ? live.rows : [];
  const memberById = new Map(team.members.map((m) => [m.id, m]));

  const teamRows: OwnerTeamRow[] = liveRows.map((r) => {
    // المنجز الحي صافيًا من التوقف — نفس معادلة getLiveBoard مفكوكة (لا منطق جديد).
    const liveMin = r.startedAtIso
      ? Math.max(0, Math.floor(
          (nowMs - new Date(r.startedAtIso).getTime() - r.pausedMsBase
            - (r.activePause ? nowMs - new Date(r.activePause.startedIso).getTime() : 0)) / 60_000,
        ))
      : 0;
    const worked = r.doneMinutes + liveMin;
    const pct = r.targetMinutes > 0 ? Math.min(100, Math.round((worked / r.targetMinutes) * 100)) : 0;

    const state: OwnerTeamState =
      r.state === "on" || r.state === "late" ? "on"
        : r.state === "done" ? "done"
          : r.state === "remote" ? "remote"
            : r.state === "paused" ? "paused"
              : r.state === "exc" ? "leave"
                : "miss";

    const badgeText =
      state === "on" ? "مداوم"
        : state === "done" ? "أنهى دوامه"
          : state === "remote" ? "عن بُعد"
            : state === "paused" ? "مستأذن"
              : state === "leave"
                ? (r.leave ? "إجازة" : r.exceptionType === "WEEKEND" ? "عطلة" : "مستثنى")
                : "لم يسجّل";

    const metaText =
      state === "on" || state === "done"
        ? `الدوام ${fmtHM(worked)}/${fmtTarget(r.targetMinutes)}`
        : state === "paused"
          ? `مستأذن${r.activePause?.authorizerLabel ? ` · لدى ${r.activePause.authorizerLabel}` : ""}`
          : state === "remote"
            ? `عن بُعد${r.remote ? ` · منذ ${r.remote.startedText}` : ""}`
            : state === "leave"
              ? (r.leave ? `إجازة ${r.leave.typeLabel} · حتى ${r.leave.toText}` : r.exceptionType === "WEEKEND" ? "عطلة أسبوعية" : "مستثنى اليوم")
              : `دوامه ${r.scheduledStartText}`;

    const m = memberById.get(r.id);
    const activeNow = m?.online ?? false;
    const activityText = activeNow
      ? "نشط الآن"
      : m?.lastSeenAt
        ? `آخر ظهور قبل ${elapsedLabel(m.lastSeenAt, now)}`
        : "لسة ما دخلت";

    // الاستقبال للبائعين فقط — المقفول عادي بسببه، ليس إنذارًا.
    const reception =
      m && (m.role === "EMPLOYEE" || m.role === "HR")
        ? m.paused
          ? { open: false, text: `مقفول · ${pauseReasonLabel(m.pauseReason)} · ${formatPauseRemaining(m.pauseUntil)}` }
          : { open: true, text: "استقبال مفتوح" }
        : null;

    return {
      id: r.id,
      name: r.name,
      state,
      pct,
      activityText,
      activeNow,
      metaText,
      // المقصّر الحقيقي فقط يبرز أحمر (غياب متتالٍ) — سلسلة getLiveBoard نفسها.
      dangerText: state === "miss" && r.absenceStreak > 0 ? `غياب ${toArabicDigits(r.absenceStreak)} يوم متتالية` : null,
      reception,
      badgeText,
    } satisfies OwnerTeamRow;
  });

  const stCount = (s: OwnerTeamState) => teamRows.filter((t) => t.state === s).length;
  const onDutyCount = stCount("on") + stCount("done");
  const teamSummary = [
    { label: "مداوم", count: onDutyCount, color: SOP.green },
    { label: "عن بُعد", count: stCount("remote"), color: SOP.teal },
    { label: "مستأذن", count: stCount("paused"), color: SOP.amber },
    { label: "إجازة", count: stCount("leave"), color: SOP.neutral },
    { label: "لم يسجّل", count: stCount("miss"), color: SOP.red },
  ].filter((s) => s.count > 0);

  // ===== ٣) التزام المتابعات — صفوف الخادم كما وصلت (الأسوأ أولًا) =====
  const commitRows = fu.rows.map((r) => ({
    ...r,
    pct: r.total > 0 ? Math.round((r.done / r.total) * 100) : 0,
  }));
  const pctTone = (pct: number) => (pct >= 90 ? SOP.green : pct >= 65 ? SOP.amber : SOP.red);

  // ===== ٤) سجل التدقيق — تجميع أنواع getOwnerAudit في مجموعات الفلترة الأربع =====
  const FUP_KINDS = new Set(["visit", "nego", "call", "interested", "followup"]);
  const CRIT_KINDS = new Set(["crit", "pull"]);
  const auditItems: OwnerAuditItem[] = audit.map((a) => ({
    id: a.id,
    group: CRIT_KINDS.has(a.kind)
      ? "crit"
      : a.employeeName === "النظام" || a.employeeName === null
        ? "sys"
        : FUP_KINDS.has(a.kind)
          ? "fup"
          : "adm",
    badge: a.badge,
    actor: a.employeeName ?? "النظام",
    desc: a.desc,
    whenText: a.whenText,
    leadId: a.leadId,
    clientName: a.clientName,
  }));

  // ===== ١) أرقام الأداء =====
  const unassigned = counts.unassigned;
  const PERIODS: { key: Period; label: string }[] = [
    { key: "all", label: "الكل" },
    { key: "week", label: "أسبوع" },
    { key: "72h", label: "٧٢س" },
    { key: "48h", label: "٤٨س" },
    { key: "24h", label: "٢٤س" },
  ];

  return (
    <div className="flex flex-col" style={{ gap: 13 }}>
      {/* ===== الترويسة (owner-home-final): تحية ١٧ + سطر التاريخ/المتصلين + أزرار بارزة ===== */}
      <header className="flex items-start justify-between" style={{ padding: "0 2px", gap: 10 }}>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 17, fontWeight: 700, color: SOP.tx }}>
            {greeting(now)}، {firstName}
          </div>
          <div style={{ fontSize: 10, color: SOP.mut, marginTop: 4 }}>
            {formatDate(now)} ·{" "}
            <b style={{ color: SOP.green, fontWeight: 700 }}>
              {toArabicDigits(onlineCount)} من {toArabicDigits(presence.length)} متصلين الآن
            </b>
          </div>
        </div>
        <MobileHeaderActions unread={notif.unread} />
      </header>

      {/* ===== تسجيل الدوام — للمدير فقط؛ المالك مراقب لا يبصم ===== */}
      {!owner && <AttendanceCard theme="mobile" />}

      {/* ===== ١) أرقام الأداء (owner-home-final) ===== */}
      <SecNum n="١" ac={SOP.gold} title="أرقام الأداء" cnt="حسب الفترة" />
      <PeriodSeg param="p" current={period} base="/m" items={PERIODS} keep={fuWin !== "today" ? { fu: fuWin } : undefined} />

      {/* كرت غير الموزّعين — نفس مصدر شارة الزئبق ونفس وجهتها (/m/unassigned) */}
      {unassigned > 0 && (
        <Link
          href="/m/unassigned"
          className="m-rise m-press-sc flex items-center"
          style={{
            boxSizing: "border-box", gap: 13, borderRadius: 18, padding: 15,
            background: `linear-gradient(135deg, color-mix(in srgb, ${SOP.red} 13%, ${SOP.plane}), ${SOP.plane})`,
            border: `1px solid color-mix(in srgb, ${SOP.red} 28%, transparent)`,
            boxShadow: `5px 5px 13px ${SOP.sd}, -5px -5px 13px ${SOP.sl}`,
            animationDelay: "50ms",
          }}
        >
          <span className="flex-none" style={{ ...ZAIN, fontSize: 38, lineHeight: 1, fontWeight: 800, color: SOP.red }}>
            {toArabicDigits(unassigned)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block" style={{ fontSize: 12, fontWeight: 700, color: SOP.tx }}>عملاء غير موزّعين</span>
            <span className="block" style={{ fontSize: "8.5px", color: SOP.mut, marginTop: 2 }}>اضغط للتوزيع — ما أحد يشتغل عليهم</span>
          </span>
          <span
            className="flex flex-none items-center"
            style={{
              boxSizing: "border-box", gap: 5, padding: "9px 15px", borderRadius: 11,
              background: SOP.red, color: SOP.onGold, fontSize: "11.5px", fontWeight: 700,
            }}
          >
            وزّع
            <ChevronLeft size={13} strokeWidth={2.4} style={{ maxWidth: 24, maxHeight: 24 }} aria-hidden />
          </span>
        </Link>
      )}

      <OwnerKpis
        totalClients={data.kpis.totalClients}
        conversion={data.kpis.conversion}
        bookings={data.kpis.bookings}
        visits={data.kpis.visits}
      />

      {/* ===== ٢) دوام وحالة الفريق ===== */}
      <SecNum
        n="٢"
        ac={SOP.green}
        title="دوام وحالة الفريق"
        cnt={`${toArabicDigits(teamRows.length)} · ${toArabicDigits(onDutyCount)} مداوم`}
      />
      <OwnerTeamSection rows={teamRows} summary={teamSummary} teamHref="/m/team" />

      {/* ===== ٣) التزام الموظفين بالمتابعات ===== */}
      <SecNum n="٣" ac={SOP.amber} title="التزام الموظفين بالمتابعات" cnt="الكل ←" cntHref="/m/team" />
      <ChipsRow param="fu" current={fuWin} base="/m" items={FU_WINDOWS} keep={period !== "all" ? { p: period } : undefined} />
      {commitRows.length === 0 ? (
        <div className="m-raise text-center" style={{ borderRadius: 13, padding: 16, fontSize: 12, color: SOP.mut }}>
          ما فيه متابعات مجدولة بهذه النافذة
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {commitRows.map((r, i) => {
            const tone = pctTone(r.pct);
            return (
              <div key={r.id} className="m-raise m-rise flex items-center" style={{ boxSizing: "border-box", borderRadius: 13, padding: "11px 12px", gap: 11, animationDelay: `${Math.min(i, 8) * 55}ms` }}>
                <span className="flex-none text-center" style={{ ...ZAIN, width: 16, fontSize: 13, fontWeight: 800, color: SOP.mut }}>
                  {toArabicDigits(i + 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center" style={{ gap: 6 }}>
                    <span className="truncate" style={{ fontSize: 12, fontWeight: 600, color: SOP.tx }}>{r.name}</span>
                    {r.missed > 0 && (
                      <span className="flex-none" style={{ boxSizing: "border-box", fontSize: "7.5px", fontWeight: 600, padding: "2px 6px", borderRadius: 5, color: SOP.red, background: `color-mix(in srgb, ${SOP.red} 14%, transparent)` }}>
                        {toArabicDigits(r.missed)} فايتة
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "8.5px", color: SOP.mut, marginTop: 2 }}>
                    أنجز {toArabicDigits(r.done)} من {toArabicDigits(r.total)}
                    {r.missed > 0 && <> · {toArabicDigits(r.missed)} فاتت بلا نتيجة</>}
                  </div>
                  <div className="overflow-hidden" style={{ height: 4, borderRadius: 2, background: SOP.sd, marginTop: 6 }}>
                    <i className="m-fillx block" style={{ height: "100%", borderRadius: 2, background: tone, transform: `scaleX(${r.pct / 100})`, transformOrigin: "right", animationDelay: `${150 + i * 70}ms` }} />
                  </div>
                </div>
                <span className="flex-none" style={{ ...ZAIN, fontSize: 18, fontWeight: 800, color: tone }}>
                  {toArabicDigits(r.pct)}٪
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== ٤) سجل التدقيق ===== */}
      <SecNum n="٤" ac={SOP.blue} title="سجل التدقيق" cnt="الكامل ←" cntHref="/m/audit" />
      <OwnerAuditSection rows={auditItems} />

      {/* ===== ٥) قمع المبيعات ===== */}
      <SecNum n="٥" ac={SOP.purple} title="قمع المبيعات" cnt="للتفصيل ←" cntHref="/m/analytics" />
      <OwnerFunnel funnel={data.funnel} />

      {/* ===== ٦) نجم الأسبوع — Placeholder (المعادلة والتصميم بانتظار الاعتماد) ===== */}
      <SecNum n="٦" ac={SOP.gold} title="نجم الأسبوع" cnt="هذا الأسبوع" />
      <div className="m-raise text-center" style={{ borderRadius: 20, padding: "18px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: SOP.tx2 }}>يُفعّل بعد اعتماد معادلة الترشيح</div>
        <div style={{ fontSize: "9.5px", color: SOP.mut, marginTop: 4 }}>الأعلى إنجازًا هذا الأسبوع — قريبًا</div>
      </div>
    </div>
  );
}

export default MobileOwnerHome;
