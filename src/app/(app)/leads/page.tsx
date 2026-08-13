import { Zain } from "next/font/google";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeadCounts, getEmployees, getNotContactedCount, getWaitingCount, getBankCheckCount, getVisitStagesCount } from "@/lib/data/leads";
import { getEmployeeLoads } from "@/lib/actions/team";
import { parseLeadFilters, buildLeadsQuery } from "@/lib/lead-filters";
import { LeadsView } from "@/components/leads/leads-view";

export const dynamic = "force-dynamic";

// خط الأرقام (Zain) — للأرقام وحدها كما في لوحة القمم ورئيسية الجوال؛ لا يمسّ خط الواجهة.
const zain = Zain({ subsets: ["arabic"], weight: ["700", "800"], variable: "--font-zain", display: "swap" });

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; stages?: string; emps?: string; sort?: string; wait?: string; nr?: string; tr?: string; bank?: string; ar?: string; range?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const manager = isManager(user.role);

  const sp = await searchParams;
  // تبويب «غير موزّعين» إداري بحتًا: يُحسم بالدور القادم من الجلسة على الخادم —
  // موظف يكتب ?tab=unassigned بيده يقع على «جاري العمل» (لا شاشة فارغة ولا أدوات توزيع).
  const tab: "working" | "archived" | "hidden" | "unassigned" =
    sp.tab === "archived" ? "archived" : sp.tab === "hidden" ? "hidden" : sp.tab === "unassigned" && manager ? "unassigned" : "working";
  const { values, assigneeIds } = parseLeadFilters(sp);

  const [counts, employees, loads, notContacted, waiting, bankCheck, visitCount] = await Promise.all([
    getLeadCounts(),
    manager ? getEmployees() : Promise.resolve([]),
    // أحمال الموظفين لشريط المالك — استدعاء قائم بحارسه (requireManager بداخله).
    // يستثني الموقوفين عن الاستقبال من قائمته، وهذا بالضبط ما يشتقّ منه الشريط
    // علامة «موقوف الاستقبال»: موجود في getEmployees وغائب هنا ⟵ موقوف.
    manager ? getEmployeeLoads() : Promise.resolve([]),
    getNotContactedCount(assigneeIds),
    getWaitingCount(),
    getBankCheckCount(),
    getVisitStagesCount(),
  ]);

  // الجدول يقرأ صفوفه من نفس الـ API GET /api/leads — كل تبويب بقيوده على الخادم.
  const query = buildLeadsQuery(tab, values);

  return (
    // متغيّر خط Zain على غلاف الصفحة — تقرأه أرقام اللوح والجدول عبر var(--font-zain).
    <div className={zain.variable}>
      <LeadsView
        query={query}
        counts={counts}
        notContacted={notContacted}
        waiting={waiting}
        bankCheck={bankCheck}
        visitCount={visitCount}
        tab={tab}
        isManager={manager}
        employees={employees}
        employeeLoads={loads.map((e) => ({ id: e.id, count: e.count }))}
        filters={values}
      />
    </div>
  );
}
