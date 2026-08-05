import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireManager } from "@/lib/auth-guards";
import { getDistributionConfig, getSweepCandidates, countAutoPool } from "@/lib/actions/distribution";
import { getLeads } from "@/lib/data/leads";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileDistributionPanel } from "@/components/mobile/distribution-panel";

export const dynamic = "force-dynamic";

/*
 * غلاف جوال للتوزيع التلقائي — يعيد استخدام سيرفر أكشنز الديسكتوب نفسها
 * من `@/lib/actions/distribution` حرفيًا. صفر استعلام جديد وصفر أكشن جديد.
 *
 * الصلاحية: طبقتان كما في الديسكتوب ((app)/distribution/page.tsx:19-20):
 *   ① بوابة الدخول requireManager()  → OWNER + ADMIN
 *   ② تفريع isOwner داخليًا           → أقسام وأزرار المالك وحده
 * الإخفاء بالواجهة للعرض فقط — كل أكشن يحمل حارسه على الخادم.
 */
export default async function MobileDistributionPage() {
  // ① بوابة الدخول — نفس فحص الديسكتوب حرفيًا (OWNER + ADMIN).
  const user = await requireManager();
  const isOwner = user.role === "OWNER";

  // ② مرشّحو السحب للمالك فقط — نفس شرط الديسكتوب (سطر ٢٩).
  const [{ config, employees, lastCron, sweepCutoffAt }, candidates, pool, unassignedRows, workingRows] = await Promise.all([
    getDistributionConfig(),
    isOwner ? getSweepCandidates() : Promise.resolve([]),
    countAutoPool(),
    // قوائم بركة التوزيع — من getLeads المحجَّمة نفسها (صفر استعلام جديد):
    getLeads({ tab: "unassigned", sort: "newest" }),
    getLeads({ tab: "working", sort: "activity" }),
  ]);

  // اشتقاق عرضي بحت من الحقول الموجودة (inAutoPool على LeadRow):
  const slim = (l: { id: string; name: string; assignedTo: { name: string } | null }) =>
    ({ id: l.id, name: l.name, assignedToName: l.assignedTo?.name ?? null });
  const admitList = unassignedRows.filter((l) => !l.inAutoPool).map(slim);
  const transferList = workingRows.filter((l) => !l.inAutoPool).map(slim);
  const removeList = [...unassignedRows, ...workingRows].filter((l) => l.inAutoPool).map(slim);

  const activeCount = employees.filter((e) => e.active && !e.paused).length;
  const onlineCount = employees.filter((e) => e.online).length;

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      {/* ===== الترويسة (نمط isAssign في النموذج) ===== */}
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link
          href="/m/more"
          aria-label="رجوع"
          className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}
        >
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>التوزيع التلقائي</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            القواعد والحدود والسجل
          </div>
        </div>
      </div>

      {/* ===== شريط حالة الفريق ===== */}
      <div
        className="m-noscroll flex overflow-x-auto"
        style={{
          boxSizing: "border-box", gap: 10,
          background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
          borderRadius: 13, padding: "10px 12px",
        }}
      >
        <span className="flex-none whitespace-nowrap" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>
          في الدور <b style={{ color: MOBILE_COLORS.gold }}>{toArabicDigits(config.order.length)}</b>
        </span>
        <span className="flex-none whitespace-nowrap" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>
          نشط <b style={{ color: MOBILE_COLORS.gold }}>{toArabicDigits(activeCount)}</b>
        </span>
        <span className="flex-none whitespace-nowrap" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>
          متصل <b style={{ color: MOBILE_STATUS.success.fg }}>{toArabicDigits(onlineCount)}</b>
        </span>
      </div>

      {/* ===== اللوحة التفاعلية (كل الكتابة عبر أكشنز الديسكتوب) ===== */}
      <MobileDistributionPanel
        config={config}
        employees={employees}
        lastCron={lastCron}
        isOwner={isOwner}
        candidates={candidates}
        pool={pool}
        admitList={admitList}
        transferList={transferList}
        removeList={removeList}
        sweepCutoffAt={sweepCutoffAt}
      />

      {/*
        أقسام لم تُنقل للجوال بعد (تقرير النشاط · مصادر العملاء · لوحة الشيتات ·
        ترتيب الدور بالسحب والإفلات) — تُدار من الديسكتوب. لا زرّ يفتح المتصفح
        داخل التطبيق، فنكتفي بسطر توضيحي.
      */}
      {isOwner && (
        <p
          style={{
            boxSizing: "border-box", borderRadius: 12, padding: "11px 13px",
            border: `1px solid ${MOBILE_COLORS.border}`, background: MOBILE_COLORS.card,
            color: MOBILE_COLORS.textMuted, fontSize: 11.5, lineHeight: 1.8,
          }}
        >
          تقرير النشاط · مصادر العملاء · لوحة الشيتات · ترتيب الدور — من الديسكتوب.
        </p>
      )}
    </div>
  );
}
