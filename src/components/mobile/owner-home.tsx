import Link from "next/link";
import { getDashboard, normalizePeriod, type Period } from "@/lib/data/dashboard";
import { getLeadCounts } from "@/lib/data/leads";
import { getNoResponseCount } from "@/lib/data/no-response";
import { getNotifications } from "@/lib/actions/notifications";
import { activeDuplicateGroupCount } from "@/lib/data/duplicates";
import { getTeamCommitment, normalizeFuWindow, FU_WINDOWS, type FuWindow } from "@/lib/data/team-commitment";
import { getAuditLog, resolveAuditNames, inferFollowupLeads, type AuditEntry, type AuditNameMaps } from "@/lib/data/audit";
import { getTeamPresence, type PresenceRow } from "@/lib/data/team";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel, greeting } from "@/lib/mobile-format";
import { formatDate, formatDateTime, RIYADH_TZ } from "@/lib/format";
import { ksaDayKey } from "@/lib/ksa-time";
import { MobileChips } from "@/components/mobile/chips";
import { MobileHeaderActions } from "@/components/mobile/header-actions";
import { OwnerKpis } from "@/components/mobile/owner-kpis";
import { TeamCommitment, type CommitmentRow } from "@/components/mobile/team-commitment";
import { TeamStrip, type StripTile } from "@/components/mobile/team-strip";
import { AuditFeed, type AuditFeedRow } from "@/components/mobile/audit-feed";
import { OwnerFunnel } from "@/components/mobile/owner-funnel";
import { AttendanceCard } from "@/components/attendance/attendance-card";

/**
 * رئيسية المالك/المدير v3 — «قرارك الآن» + أرقامك + شريط الفريق الحي +
 * التزام المتابعات + سجل التدقيق + القمع المطوي. عرض وتغليف خالص:
 * كل البيانات من الدوال القائمة (+ توسعتان معلنتان: عدّاد مكرري اليوم في
 * activeDuplicateGroupCount وإنتاج اليوم في getTeamPresence) — صفر منطق أعمال جديد.
 */

const ZAIN = { fontFamily: "var(--font-zain), var(--font-sans)" };
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ===================== شريط الفريق: الحالة وشارة المدة =====================

function sinceParts(p: PresenceRow, now: number): Pick<StripTile, "state" | "sinceNum" | "sinceUnit"> {
  // مدة الجلسة غير متاحة بقاعدة البيانات (loginAt في الـJWT فقط) — لا نخترع مدة:
  // المتصل شارته «متصل / الآن» والبقية «X من آخر ظهور».
  if (p.online) return { state: "on", sinceNum: "متصل", sinceUnit: "الآن" };
  if (!p.lastSeenAt) return { state: "dorm", sinceNum: "—", sinceUnit: "ما دخل أبدًا" };
  const diff = now - p.lastSeenAt.getTime();
  const mins = Math.max(1, Math.floor(diff / 60_000));
  if (diff < HOUR_MS) return { state: "soon", sinceNum: toArabicDigits(mins), sinceUnit: "دقيقة من آخر ظهور" };
  const hours = Math.floor(diff / HOUR_MS);
  if (hours < 24) {
    return { state: "away", sinceNum: toArabicDigits(hours), sinceUnit: `${hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : hours <= 10 ? "ساعات" : "ساعة"} من آخر ظهور` };
  }
  const days = Math.floor(diff / DAY_MS);
  const unit = `${days === 1 ? "يوم" : days === 2 ? "يومين" : days <= 10 ? "أيام" : "يوم"} من آخر ظهور`;
  if (days >= 15) return { state: "dorm", sinceNum: toArabicDigits(days), sinceUnit: unit };
  return { state: "away", sinceNum: toArabicDigits(days), sinceUnit: unit };
}

// ===================== سجل التدقيق: التصنيف والتعريب =====================

function auditKind(e: AuditEntry): AuditFeedRow["kind"] {
  const a = e.action;
  if (/Pull|warned/i.test(a) || a.includes("security") || a.includes("delete")
    || a.startsWith("REVEAL") || a.startsWith("HIDE") || a.startsWith("session.") || a.startsWith("auth.")) return "crit";
  if (!e.userId || /auto/i.test(a)) return "sys";
  if (a.startsWith("followup.") || a === "lead.stage" || a === "lead.firstStage") return "fup";
  return "adm";
}

/** شارة الفعل — قاموس ثابت بالواجهة فوق مفاتيح action؛ المجهول «إجراء». */
function auditBadge(action: string, summary: string): string {
  if (action === "followup.added") return /زيار/.test(summary) ? "زيارة" : "متابعة";
  if (action === "followup.edited") return "تعديل";
  if (action === "lead.stage" || action === "lead.firstStage") return "مرحلة";
  if (action.startsWith("booking.")) return /دفعة/.test(summary) ? "دفعة" : "حجز";
  if (/Pull/i.test(action)) return "سحب";
  if (/warned/i.test(action)) return "إنذار";
  if (/distributed/i.test(action)) return "توزيع";
  if (action === "lead.reassigned" || action === "lead.transferred") return "نقل";
  if (action === "lead.created") return "إضافة";
  if (action === "lead.recovered") return "استرجاع";
  if (action.includes("archive")) return "أرشفة";
  if (action.startsWith("REVEAL") || action.startsWith("HIDE") || action.includes("security")) return "أمان";
  if (action.includes("delete")) return "حذف";
  return "إجراء";
}

// cuid داخل نص summary — يُستبدل بالاسم المحلول (نفس نمط /m/audit حرفيًا).
const CUID_RE = /\bc[a-z0-9]{24}\b/g;
const resolveSummary = (summary: string, names: AuditNameMaps): string =>
  summary
    .replace(CUID_RE, (id) => names.leadNames[id] ?? names.userNames[id] ?? "عنصر محذوف")
    // تنظيف الأنماط الخام: «· العميل=خالد» → «· خالد» (لا مصطلحات تقنية بالواجهة).
    .replace(/العميل\s*=\s*/g, "");

function leadIdIn(summary: string, names: AuditNameMaps): string | null {
  for (const id of summary.match(CUID_RE) ?? []) if (names.leadNames[id]) return id;
  return null;
}

/**
 * معرّف العميل المعتمد للسهم — **لا يُقبل إلا معرّفًا حُلّ فعلًا إلى عميل قائم**
 * (`leadNames` تأتي من استعلام جدول العملاء). المسار المستدلّ (`inferFollowupLeads`)
 * كان يُمرَّر بلا هذا التحقق، فمعرّف لعميل محذوف/مدموج يبني سهمًا يفتح ٤٠٤.
 * سهم لا يعمل أسوأ من غياب السهم — فالمجهول يُسقط السهم بالكامل.
 */
function confirmedLeadId(e: AuditEntry, names: AuditNameMaps, inferred: Record<string, string>): string | null {
  const id = leadIdIn(e.summary, names) ?? inferred[e.id] ?? null;
  return id && names.leadNames[id] ? id : null;
}

/** عنوان يوم المجموعة بيوم الرياض — «اليوم/أمس — {التاريخ}» والأقدم تاريخ فقط. */
function dayTitle(d: Date, todayKey: string, yesterdayKey: string): string {
  const key = ksaDayKey(d);
  const label = new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    calendar: "gregory", timeZone: RIYADH_TZ, weekday: "long", day: "numeric", month: "short",
  }).format(d);
  if (key === todayKey) return `اليوم — ${label}`;
  if (key === yesterdayKey) return `أمس — ${label}`;
  return label;
}

// ===================== عناوين الأقسام =====================

function Sec({ color, title, sub, cnt, cntHref }: {
  color?: string; title: string; sub?: string; cnt?: string; cntHref?: string;
}) {
  const bar = color ?? MOBILE_COLORS.gold;
  return (
    <div className="flex items-start" style={{ gap: 8, margin: "6px 2px 0" }}>
      <span aria-hidden className="flex-none" style={{ width: 3.5, height: 16, borderRadius: 3, background: bar, boxShadow: `0 0 9px ${bar}`, marginTop: 2 }} />
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 15, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, fontWeight: 600, marginTop: 3, lineHeight: 1.6 }}>{sub}</div>}
      </div>
      {cnt && (cntHref ? (
        <Link href={cntHref} className="flex-none" style={{ fontSize: 11, color: MOBILE_COLORS.gold, fontWeight: 700, marginTop: 2 }}>{cnt}</Link>
      ) : (
        <span className="flex-none" style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, fontWeight: 700, marginTop: 2 }}>{cnt}</span>
      ))}
    </div>
  );
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

  const [data, counts, dupCounts, noResponseCount, notif, commitment, presence, auditEntries] = await Promise.all([
    getDashboard(period),
    // نفس دالة شارة الزئبق حرفيًا — ومغلّفة بـcache() فالبطاقة والشارة تقرآن نتيجة الطلب الواحدة.
    getLeadCounts(),
    owner ? activeDuplicateGroupCount() : Promise.resolve({ total: 0, newToday: 0 }),
    owner ? getNoResponseCount() : Promise.resolve(0),
    getNotifications(),
    getTeamCommitment(fuWin, now),
    getTeamPresence(),
    // ٣٠ سجلًا: تُعرض آخر ١٥ بعد الفلترة، والهامش يمنع فراغ القائمة عند فلتر ضيّق
    // (حرِج/النظام). السجل الكامل في /m/audit بحدّه الخاص (١٥٠).
    getAuditLog({ limit: 30 }),
  ]);
  const inferred = await inferFollowupLeads(auditEntries);
  const names = await resolveAuditNames(auditEntries, Object.values(inferred));

  const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "مرحبًا";
  const onlineCount = presence.filter((p) => p.online).length;

  // ===== شريط الفريق: بلاطات بحالاتها — الراكد خلف الطي =====
  const allTiles: StripTile[] = presence.map((p) => ({
    id: p.id,
    name: p.name,
    fu: p.fuToday,
    visits: p.visitsToday,
    bookings: p.bookingsToday,
    ...sinceParts(p, nowMs),
  }));
  const stripTiles = allTiles.filter((t) => t.state !== "dorm");
  const dormTiles = allTiles.filter((t) => t.state === "dorm");

  // ===== التزام المتابعات: الأسوأ أولًا + سطر من بلا مواعيد =====
  const commitAll = data.team.map((t) => {
    const c = commitment.get(t.id);
    const done = c?.done ?? 0;
    const missed = c?.missed ?? 0;
    const total = done + missed;
    return {
      id: t.id, name: t.name, done, missed, total,
      pct: total > 0 ? Math.round((done / total) * 100) : 0,
      lastLabel: c?.lastAt ? `آخر نشاط قبل ${elapsedLabel(c.lastAt, now)}` : "لا نشاط مسجّل",
    } satisfies CommitmentRow;
  });
  const commitRows = commitAll.filter((r) => r.total > 0).sort((a, b) => a.pct - b.pct || b.missed - a.missed);
  const idleNames = commitAll.filter((r) => r.total === 0).map((r) => r.name);
  const FU_SUB: Record<FuWindow, string> = {
    today: "متابعات مجدولة سابقًا حان موعدها اليوم — كم أنجز منها وكم فاته",
    yesterday: "متابعات مجدولة سابقًا حان موعدها أمس — كم أنجز منها وكم فاته",
    all: "كل المتابعات المجدولة التي حان موعدها — كم أنجز منها وكم فاته",
  };

  // ===== سجل التدقيق: صفوف جاهزة للعرض (التصنيف والتعريب والأيام هنا — العميل يعرض فقط) =====
  const todayKey = ksaDayKey(now);
  const yesterdayKey = ksaDayKey(new Date(nowMs - DAY_MS));
  const auditRows: AuditFeedRow[] = auditEntries.map((e) => {
    const leadId = confirmedLeadId(e, names, inferred);
    return {
      id: e.id,
      kind: auditKind(e),
      actor: e.userId && e.userId === user.id ? "أنت" : (e.userName ?? "النظام"),
      badge: auditBadge(e.action, e.summary),
      head: resolveSummary(e.summary, names),
      leadId,
      leadName: leadId ? (names.leadNames[leadId] ?? null) : null,
      whenText: `قبل ${elapsedLabel(e.createdAt, now)}`,
      fullWhen: formatDateTime(e.createdAt),
      group: dayTitle(e.createdAt, todayKey, yesterdayKey),
    };
  });

  // ===== «قرارك الآن» — بطاقة عريضة + ثنائي (المصادر القائمة حصرًا) =====
  const unassigned = counts.unassigned;
  const dupN = dupCounts.newToday > 0 ? dupCounts.newToday : dupCounts.total;
  const dupLabel = dupCounts.newToday > 0 ? "مكرّرو اليوم" : "مكرّرون";
  const noDecisions = unassigned === 0 && noResponseCount === 0 && dupN === 0;

  const PERIODS: { key: Period; label: string }[] = [
    { key: "all", label: "الكل" },
    { key: "week", label: "أسبوع" },
    { key: "72h", label: "٧٢ ساعة" },
    { key: "48h", label: "٤٨ ساعة" },
    { key: "24h", label: "٢٤ ساعة" },
  ];

  return (
    <div className="flex flex-col" style={{ gap: 13 }}>
      {/* ===== الترويسة ===== */}
      <header className="flex items-start justify-between" style={{ padding: "0 2px", gap: 10 }}>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 21, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>
            {greeting(now)} {firstName} 👋
          </div>
          <div style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginTop: 4, fontWeight: 600 }}>
            {formatDate(now)} · <span style={{ color: MOBILE_STATUS.success.base }}>{toArabicDigits(onlineCount)}</span> من {toArabicDigits(presence.length)} متصلين الآن
          </div>
        </div>
        <MobileHeaderActions unread={notif.unread} />
      </header>

      {/* ===== تسجيل الدوام — للمدير فقط؛ المالك مراقب لا يبصم ===== */}
      {!owner && <AttendanceCard theme="mobile" />}

      {/* ===== قرارك الآن ===== */}
      <Sec color={MOBILE_STATUS.danger.base} title="قرارك الآن" cnt="اليوم" />
      {noDecisions ? (
        <div className="flex items-center justify-center" style={{ boxSizing: "border-box", minHeight: 74, borderRadius: 18, background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, fontSize: 13, color: MOBILE_COLORS.textSecondary }}>
          ما فيه قرارات معلّقة 👏
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 11 }}>
          {unassigned > 0 && (
            <Link
              href="/m/unassigned"
              className="m-rise m-press relative flex items-center overflow-hidden"
              style={{
                boxSizing: "border-box", gap: 16, borderRadius: 22, padding: "19px 18px",
                background: `linear-gradient(135deg, ${MOBILE_STATUS.danger.bg} 0%, ${MOBILE_COLORS.card} 75%)`,
                border: `1px solid ${MOBILE_STATUS.danger.border}`,
              }}
            >
              <span aria-hidden style={{ position: "absolute", top: 0, insetInline: 0, height: 3, background: `linear-gradient(90deg, transparent, ${MOBILE_STATUS.danger.base}, transparent)`, boxShadow: `0 0 16px ${MOBILE_STATUS.danger.base}` }} />
              <span className="flex-none" style={{ ...ZAIN, fontSize: 50, lineHeight: 0.95, fontWeight: 800, color: MOBILE_STATUS.danger.base, textShadow: `0 0 26px ${MOBILE_STATUS.danger.bg}` }}>
                {toArabicDigits(unassigned)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block" style={{ fontSize: 16, fontWeight: 800, color: MOBILE_COLORS.textPrimary, lineHeight: 1.4 }}>عملاء غير موزّعين</span>
                <span className="block" style={{ fontSize: 12, color: MOBILE_COLORS.textMuted, fontWeight: 600, marginTop: 4 }}>ما أحد يشتغل عليهم</span>
              </span>
              <span className="m-ctapulse flex flex-none items-center" style={{ boxSizing: "border-box", height: 46, padding: "0 20px", borderRadius: 14, background: MOBILE_STATUS.danger.base, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 800 }}>
                وزّع ←
              </span>
            </Link>
          )}
          {(noResponseCount > 0 || dupN > 0) && (
            <div className="grid grid-cols-2" style={{ gap: 11 }}>
              {noResponseCount > 0 && (
                <Link
                  href="/m/no-response"
                  className="m-rise m-press relative flex flex-col overflow-hidden"
                  style={{ boxSizing: "border-box", borderRadius: 19, padding: "15px 14px 13px", background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, animationDelay: "70ms" }}
                >
                  <span aria-hidden style={{ position: "absolute", top: 0, insetInline: 0, height: 2.5, background: `linear-gradient(90deg, transparent, ${MOBILE_STATUS.warning.base}, transparent)`, boxShadow: `0 0 12px ${MOBILE_STATUS.warning.base}` }} />
                  <span className="flex items-center" style={{ gap: 10 }}>
                    <span style={{ ...ZAIN, fontSize: 30, lineHeight: 1, fontWeight: 800, color: MOBILE_STATUS.warning.base }}>{toArabicDigits(noResponseCount)}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: MOBILE_COLORS.textSecondary, lineHeight: 1.5 }}>لم يتم<br />الرد</span>
                  </span>
                  <span className="flex items-center justify-center" style={{ boxSizing: "border-box", marginTop: 12, height: 38, borderRadius: 11, background: MOBILE_STATUS.warning.bg, border: `1px solid ${MOBILE_STATUS.warning.border}`, color: MOBILE_STATUS.warning.base, fontSize: 12, fontWeight: 800 }}>
                    راجع
                  </span>
                </Link>
              )}
              {dupN > 0 && (
                <Link
                  href="/m/duplicates"
                  className="m-rise m-press relative flex flex-col overflow-hidden"
                  style={{ boxSizing: "border-box", borderRadius: 19, padding: "15px 14px 13px", background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, animationDelay: "130ms" }}
                >
                  <span aria-hidden style={{ position: "absolute", top: 0, insetInline: 0, height: 2.5, background: `linear-gradient(90deg, transparent, ${MOBILE_COLORS.sky}, transparent)`, boxShadow: `0 0 12px ${MOBILE_COLORS.sky}` }} />
                  <span className="flex items-center" style={{ gap: 10 }}>
                    <span style={{ ...ZAIN, fontSize: 30, lineHeight: 1, fontWeight: 800, color: MOBILE_COLORS.sky }}>{toArabicDigits(dupN)}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: MOBILE_COLORS.textSecondary, lineHeight: 1.5 }}>{dupLabel}</span>
                  </span>
                  <span className="flex items-center justify-center" style={{ boxSizing: "border-box", marginTop: 12, height: 38, borderRadius: 11, background: MOBILE_COLORS.skyBg, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.sky, fontSize: 12, fontWeight: 800 }}>
                    افتح
                  </span>
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== أرقامك ===== */}
      <Sec title="أرقامك" cnt="حسب الفترة" />
      <MobileChips param="p" current={period} base="/m" items={PERIODS} goldGradient keep={fuWin !== "today" ? { fu: fuWin } : undefined} />
      <OwnerKpis
        total={data.kpis.newInPeriod}
        conversion={data.kpis.conversion}
        bookings={data.kpis.bookings}
        visits={data.kpis.visits}
      />

      {/* ===== الفريق الآن ===== */}
      <Sec color={MOBILE_STATUS.success.base} title="الفريق الآن" sub="آخر ظهور وإنتاج اليوم — يلف تلقائيًا أو اسحب" />
      <TeamStrip tiles={stripTiles} dorm={dormTiles} onlineCount={onlineCount} fileLinks={user.role === "OWNER"} />

      {/* ===== التزام الموظفين بالمتابعات ===== */}
      <Sec title="التزام الموظفين بالمتابعات" sub={FU_SUB[fuWin]} cnt={`الكل (${toArabicDigits(data.team.length)}) ←`} cntHref="/m/team" />
      <MobileChips param="fu" current={fuWin} base="/m" items={FU_WINDOWS} goldGradient keep={period !== "all" ? { p: period } : undefined} />
      <TeamCommitment rows={commitRows} idleNames={idleNames} fileLinks={user.role === "OWNER"} />

      {/* ===== سجل التدقيق ===== */}
      <Sec title="سجل التدقيق" sub="كل حركة بالنظام — اضغط أي سطر يفتح تفاصيله" cnt="الكامل ←" cntHref="/m/audit" />
      <AuditFeed rows={auditRows} />

      {/* ===== القمع ===== */}
      <Sec title="قمع المبيعات" cnt="اضغط للتفصيل" />
      <OwnerFunnel funnel={data.funnel} />
    </div>
  );
}

export default MobileOwnerHome;
