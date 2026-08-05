import Link from "next/link";
import {
  Archive, Share2, Copy, ScrollText, BarChart3, Users, Settings,
  MessagesSquare, Building2, PhoneMissed, Handshake,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeadCounts } from "@/lib/data/leads";
import { getSettings } from "@/lib/data/settings";
import { getBookings } from "@/lib/data/bookings";
import { getProjectsOverview } from "@/lib/data/projects";
import { getNoResponseCount } from "@/lib/data/no-response";
import { activeDuplicateGroupCount } from "@/lib/data/duplicates";
import { getDistributionConfig } from "@/lib/actions/distribution";
import { getMyAvailability } from "@/lib/actions/availability";
import { getChatPeers } from "@/lib/actions/chat";
import { roleLabel } from "@/lib/labels";
import { pauseReasonLabel, formatPauseRemaining } from "@/lib/availability";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MobileProfileCard } from "@/components/mobile/profile-card";

export const dynamic = "force-dynamic";

const APP_VERSION = "١٫٠٫٠";

type Tile = {
  href: string;
  label: string;
  sub: string;
  icon: LucideIcon;
  /** شارة حمراء دائرية — تظهر فقط لعدد > ٠ (الصفر بلا معنى فيُسقط). */
  badge?: number;
};

/**
 * «المزيد» — لوحة بلاطات: الملف الشخصي فوق، ثم شبكة ٢×٢ لكل الشاشات.
 * التفاصيل (الفريق والمتابعات · الإشعارات والأصوات · الأمان) خلف بلاطاتها
 * في /m/team و/m/settings بنفس الحراس — لا شيء مسطّح هنا.
 */
export default async function MobileMorePage() {
  const user = await requireUser();
  const manager = isManager(user.role);
  const owner = user.role === "OWNER";

  const [settings, counts, bookings, projects, avail, peers, dist, dupCount, noRespCount] = await Promise.all([
    getSettings(),
    getLeadCounts(),
    getBookings(),          // محجَّمة بالدور داخلها (المبالغ تُحجب — ما نعرض منها إلا الأعداد).
    getProjectsOverview(),
    getMyAvailability(),
    getChatPeers(),
    // «الفريق» — نفس DistEmployee من getDistributionConfig (requireManager داخلها).
    manager ? getDistributionConfig() : Promise.resolve(null),
    owner ? activeDuplicateGroupCount() : Promise.resolve(0),
    owner ? getNoResponseCount() : Promise.resolve(0),
  ]);

  const units = projects.kpis.available + projects.kpis.reserved + projects.kpis.sold;
  const pausedCount = dist ? dist.employees.filter((e) => e.paused).length : 0;

  // ===== البلاطات — كل سطر ثانوي من بيانات موجودة فعلًا =====
  const tiles: Tile[] = [
    {
      href: "/m/bookings", label: "خط المبيعات", icon: Handshake,
      sub: `${toArabicDigits(bookings.kpis.inProgress)} قيد البيع · ${toArabicDigits(bookings.kpis.sold)} مباع`,
    },
    {
      href: "/m/projects", label: "المشاريع والوحدات", icon: Building2,
      sub: `${toArabicDigits(projects.kpis.projects)} مشاريع · ${toArabicDigits(units)} وحدة`,
    },
    {
      href: "/m/analytics", label: manager ? "التحليلات" : "أدائي", icon: BarChart3,
      sub: "أسأل بياناتك",
    },
    {
      href: "/m/chat", label: "الشات الداخلي", icon: MessagesSquare,
      sub: `${toArabicDigits(peers.length)} زميل`,
    },
    ...(manager && dist
      ? [
          {
            href: "/m/team", label: "الفريق", icon: Users,
            sub: `${toArabicDigits(dist.employees.length)} موظفين · المتابعات`,
            badge: pausedCount,
          },
          {
            href: "/m/distribution", label: "التوزيع التلقائي", icon: Share2,
            sub: "قواعد وحدود",
            badge: counts.unassigned,
          },
          {
            href: "/m/audit", label: "سجل التدقيق", icon: ScrollText,
            sub: "مين غيّر وش",
          },
        ]
      : []),
    {
      href: "/m/settings", label: "الإعدادات", icon: Settings,
      sub: manager ? "الشركة والفريق" : "الإشعارات والأمان",
    },
    {
      href: "/m/leads?tab=hidden", label: "المؤرشف", icon: Archive,
      sub: `${toArabicDigits(counts.hidden)} عميل مخفي`,
    },
    ...(owner
      ? [
          {
            href: "/m/duplicates", label: "العملاء المكررون", icon: Copy,
            sub: `${toArabicDigits(dupCount)} مجموعة`,
            badge: dupCount,
          },
          {
            href: "/m/no-response", label: "لم يتم الرد", icon: PhoneMissed,
            sub: "بانتظار قرارك",
            badge: noRespCount,
          },
        ]
      : []),
  ];

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary, padding: "0 2px" }}>المزيد</h1>

      {/* ===== ٢-أ) بطاقة الملف الشخصي ===== */}
      {/* نص المدّة يُصاغ هنا (خادم) — Date.now() داخل مكوّن عميل يولّد اختلاف ترطيب. */}
      <MobileProfileCard
        name={user.name ?? "مستخدم"}
        roleText={roleLabel(user.role)}
        canPause={user.role === "EMPLOYEE"}
        paused={avail.paused}
        pauseText={
          avail.paused
            ? `موقوف مؤقتًا — ${pauseReasonLabel(avail.reason)} · ${formatPauseRemaining(avail.pauseUntil)}`
            : null
        }
      />

      {/* ===== ٢-ب) شبكة البلاطات ===== */}
      <div className="grid grid-cols-2" style={{ gap: 9 }}>
        {tiles.map((t, i) => {
          const Icon = t.icon;
          const n = t.badge ?? 0;
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className="m-rise relative flex flex-col"
              style={{
                boxSizing: "border-box", gap: 8, minHeight: 104,
                background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                borderRadius: 16, padding: "13px 13px 14px",
                animationDelay: `${Math.min(i, 8) * 45}ms`,
              }}
            >
              <span
                className="flex flex-none items-center justify-center"
                style={{
                  boxSizing: "border-box", width: 34, height: 34, borderRadius: 12,
                  background: MOBILE_COLORS.goldBg,
                }}
              >
                <Icon size={17} strokeWidth={1.9} style={{ color: MOBILE_COLORS.gold }} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate" style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
                  {t.label}
                </span>
                <span className="block truncate" style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
                  {t.sub}
                </span>
              </span>
              {n > 0 && (
                <span
                  className="absolute flex items-center justify-center"
                  style={{
                    boxSizing: "border-box", top: 11, insetInlineEnd: 12, minWidth: 20, height: 20,
                    borderRadius: 10, background: MOBILE_STATUS.danger.base, color: "#FFFFFF",
                    fontSize: 10, fontWeight: 700, padding: "0 5px",
                  }}
                >
                  {toArabicDigits(n > 99 ? 99 : n)}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* ===== الخروج + الهوية ===== */}
      {/* ?to=/m/login: بدونها ينتهي الخروج على /login بتخطيط الويب، والدخول
          من هناك يوجّه لـ/dashboard فيخرج المستخدم من التطبيق كليًا. */}
      <a href="/api/logout?to=/m/login" className="flex items-center justify-center"
        style={{
          boxSizing: "border-box", minHeight: 52, borderRadius: 16,
          border: `1px solid ${MOBILE_STATUS.danger.border}`, background: MOBILE_STATUS.danger.bg,
          color: MOBILE_STATUS.danger.base, fontSize: "14.5px", fontWeight: 700, marginTop: 4,
        }}>
        تسجيل الخروج
      </a>
      <div className="text-center" style={{ fontSize: 11, color: MOBILE_COLORS.dim1, lineHeight: 1.9, padding: "4px 0" }}>
        ترخيص فال (REGA) {toArabicDigits(settings.falLicense ?? "1200021029")}
        <br />
        الإصدار {APP_VERSION}
      </div>
    </div>
  );
}
