import { Role } from "@prisma/client";
import { Zain } from "next/font/google";
import { getOwnerKpis, normalizeOwnerPeriod } from "@/lib/data/owner-dashboard";
import { OwnerDateFilter } from "@/components/owner/owner-date-filter";
import { KpiCards } from "@/components/owner/kpi-cards";
import { AttendanceCard } from "@/components/attendance/attendance-card";

// خط الأرقام (Zain) — نفس عرف صفحتي القمم والعملاء: متغيّر على غلاف الصفحة.
const zain = Zain({ subsets: ["arabic"], weight: ["700", "800", "900"], variable: "--font-zain", display: "swap" });

/**
 * لوحة المالك — التجميع الكامل (المرجع owner-final-structure.html).
 *
 * توكنات المرجع تُعرَّف مرة واحدة هنا كمتغيّرات CSS بنطاق اللوحة (--od-*)
 * فتقرأها كل الأقسام — لا نلمس globals.css ولا ثيم بقية التطبيق.
 */
const OD_TOKENS = {
  "--od-raised": "#15171b",
  "--od-raised2": "#1a1d22",
  "--od-hair": "rgba(255,255,255,.06)",
  "--od-t1": "#F4F5F7",
  "--od-t2": "#9A9CA4",
  "--od-t3": "#65676E",
  "--od-won": "#34d494",
  "--od-red": "#ff7a8a",
  "--od-try": "#e8a54d",
  "--od-visit": "#5b9def",
  "--od-nego": "#a98edb",
  "--od-later": "#5bbccb",
  "--od-int": "#34d494",
  "--od-new": "#8b93a3",
} as React.CSSProperties;

/** رأس قسم — شرطة ذهبية + عنوان + خانة يسار (فلتر/رابط) على نمط `.sec` من المرجع. */
export function SecHeader({ title, count, accent = "var(--gold)", children }: {
  title: string;
  count?: string;
  accent?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-[17px] mt-8 flex flex-wrap items-center gap-2.5 px-0.5 text-xl font-bold text-foreground">
      <span className="h-6 w-1 rounded-sm" style={{ background: accent }} aria-hidden />
      {title}
      {count && <span className="text-xs font-normal" style={{ color: "var(--od-t3)" }}>{count}</span>}
      {children}
    </div>
  );
}

export type OwnerSearchParams = { dp?: string; df?: string; dt?: string };

export async function OwnerDashboard({ userRole, sp }: { userRole: Role; sp: OwnerSearchParams }) {
  const period = normalizeOwnerPeriod(sp.dp);
  const kpis = await getOwnerKpis(period, sp.df, sp.dt);

  return (
    <div className={`${zain.variable} mx-auto max-w-[1500px]`} style={OD_TOKENS}>
      {/* رأس الصفحة — pagehead من المرجع */}
      <header className="mb-5 flex items-center gap-3.5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">هلا إدارة المبيعات</h1>
          <p className="mt-1 text-[14.5px]" style={{ color: "var(--od-t3)" }}>نظرة اليوم الكاملة</p>
        </div>
      </header>

      {/* تسجيل الدوام — للمدير (ADMIN) فقط: المالك مراقب لا يبصم. حاجة وظيفية خارج المرجع. */}
      {userRole === Role.ADMIN && (
        <div className="mb-5 max-w-md">
          <AttendanceCard theme="web" />
        </div>
      )}

      {/* ١) الأرقام الأساسية */}
      <SecHeader title="الأرقام الأساسية">
        <OwnerDateFilter period={kpis.range.period} fromKey={kpis.range.fromKey} toKey={kpis.range.toKey} />
      </SecHeader>
      <KpiCards kpis={kpis} />
    </div>
  );
}
