import { LeadStage } from "@prisma/client";

/** خيارات ترتيب قائمة العملاء. الافتراضي activity (الأحدث نشاطًا). */
export type LeadSort = "activity" | "newest" | "oldest" | "name";
export const LEAD_SORTS: LeadSort[] = ["activity", "newest", "oldest", "name"];
export const DEFAULT_LEAD_SORT: LeadSort = "activity";

/** مظلة «مهتم» — كل المتفاعلين (مصدر واحد يشاركه شريط الفلاتر). */
export const INTEREST_UMBRELLA: LeadStage[] = ["INTERESTED", "VISIT_SCHEDULED", "VIEWING", "NEGOTIATION", "FOLLOW_UP_LATER"];

/**
 * فلتر «زيارة» الموحّد («الزيارة زيارة»): مرحلتا الزيارة (موعد + زار) شريحة واحدة
 * في شريط الفلاتر وقيمة رابط واحدة "visit". المرحلتان تبقيان منفصلتين داخليًا —
 * التوحيد في الفلتر والرابط فقط، وكل صف يعرض مرحلته الفعلية بشارتها.
 */
export const VISIT_FILTER_STAGES: LeadStage[] = ["VISIT_SCHEDULED", "VIEWING"];
export const VISIT_FILTER_TOKEN = "visit";

/** يطوي زوج مرحلتي الزيارة إلى "visit" واحدة في الرابط (نظافة + ثبات الشكل). */
export function collapseStagesParam(stages: string[]): string[] {
  const rest = stages.filter((s) => !(VISIT_FILTER_STAGES as string[]).includes(s) && s !== VISIT_FILTER_TOKEN);
  const hasVisit = stages.some((s) => (VISIT_FILTER_STAGES as string[]).includes(s) || s === VISIT_FILTER_TOKEN);
  return hasVisit ? [...rest, VISIT_FILTER_TOKEN] : rest;
}

/** سبب الأرشفة (فلتر تبويب «مؤرشف»): نهائي / مسوّق / يدوي — فارغ = الكل. */
export type ArchiveReason = "" | "final" | "marketer" | "manual";
const ARCHIVE_REASONS: ArchiveReason[] = ["", "final", "marketer", "manual"];

/** قيم الفلاتر كما في الرابط (مشتركة بين جدول العملاء والكانبان). wait = «في الانتظار» · tr = «محوَّل» · bank = «حسبة البنك». */
export type LeadFilterValues = { q: string; stages: string[]; emps: string[]; sort: LeadSort; wait: boolean; tr: boolean; bank: boolean; ar: ArchiveReason };

export type ParsedLeadFilters = {
  q: string;
  stages: LeadStage[];
  assigneeIds: string[];
  includeUnassigned: boolean;
  /** فلتر «في الانتظار»: آخر متابعة «لم يستجب» أو «في الانتظار» — للجميع ضمن صلاحيته. */
  waiting: boolean;
  transferred: boolean;
  /** فلتر «حسبة البنك»: آخر متابعة للعميل نتيجتها BANK_CHECK — للجميع ضمن صلاحيته. */
  bankCheck: boolean;
  archiveReason: ArchiveReason;
  sort: LeadSort;
  values: LeadFilterValues;
};

/** بناء سلسلة استعلام GET /api/leads من التبويب + الفلاتر. (working = الافتراضي بلا بارامتر). */
export function buildLeadsQuery(tab: "working" | "archived" | "hidden" | "unassigned" | "all", v: LeadFilterValues): string {
  const p = new URLSearchParams();
  if (tab !== "working") p.set("tab", tab);
  if (v.q) p.set("q", v.q);
  if (v.stages.length) p.set("stages", collapseStagesParam(v.stages).join(","));
  if (v.emps.length) p.set("emps", v.emps.join(","));
  if (v.sort !== DEFAULT_LEAD_SORT) p.set("sort", v.sort); // نظافة الرابط: الافتراضي بلا بارامتر
  if (v.wait) p.set("wait", "1"); // فلتر «في الانتظار» — آخر متابعة لم يستجب/في الانتظار
  if (v.tr) p.set("tr", "1"); // فلتر «محوَّل» — المحوّلون بالبيانات فقط
  if (v.bank) p.set("bank", "1"); // فلتر «حسبة البنك» — آخر متابعة BANK_CHECK
  if (v.ar) p.set("ar", v.ar); // فلتر سبب الأرشفة (تبويب «مؤرشف»)
  return p.toString();
}

/** تحويل searchParams إلى فلاتر موحّدة — يستخدمه الجدول والكانبان و GET /api/leads. */
export function parseLeadFilters(sp: { q?: string; stages?: string; emps?: string; sort?: string; wait?: string; nr?: string; tr?: string; bank?: string; ar?: string }): ParsedLeadFilters {
  const q = sp.q ?? "";
  // #32: نصفّي القيم على أعضاء LeadStage — أي قيمة خاطئة في الرابط تُتجاهل بدل ٥٠٠.
  // فلتر «زيارة» الموحّد: "visit" أو أي من المرحلتين القديمتين (روابط محفوظة قديمة) ⟵ المرحلتان معًا.
  const rawStageTokens = sp.stages ? sp.stages.split(",").filter(Boolean) : [];
  const expandedStages = rawStageTokens.flatMap((t) =>
    t === VISIT_FILTER_TOKEN || (VISIT_FILTER_STAGES as string[]).includes(t) ? (VISIT_FILTER_STAGES as string[]) : [t]);
  const stages = [...new Set(expandedStages)].filter((s): s is LeadStage => s in LeadStage);
  const empTokens = sp.emps ? sp.emps.split(",").filter(Boolean) : [];
  const includeUnassigned = empTokens.includes("none");
  const assigneeIds = empTokens.filter((t) => t !== "none");
  // ترتيب: أي قيمة غير مسموحة → الافتراضي activity.
  const sort: LeadSort = LEAD_SORTS.includes(sp.sort as LeadSort) ? (sp.sort as LeadSort) : DEFAULT_LEAD_SORT;
  // «في الانتظار»: المفتاح الجديد wait=1 — وnr=1 القديم (روابط محفوظة) يفتح نفس الفلتر.
  const waiting = sp.wait === "1" || sp.nr === "1";
  const transferred = sp.tr === "1";
  const bankCheck = sp.bank === "1";
  const archiveReason: ArchiveReason = ARCHIVE_REASONS.includes(sp.ar as ArchiveReason) ? (sp.ar as ArchiveReason) : "";
  return { q, stages, assigneeIds, includeUnassigned, waiting, transferred, bankCheck, archiveReason, sort, values: { q, stages, emps: empTokens, sort, wait: waiting, tr: transferred, bank: bankCheck, ar: archiveReason } };
}
