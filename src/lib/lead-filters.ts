import { LeadStage } from "@prisma/client";

/** خيارات ترتيب قائمة العملاء. الافتراضي activity (الأحدث نشاطًا). */
export type LeadSort = "activity" | "newest" | "oldest" | "name";
export const LEAD_SORTS: LeadSort[] = ["activity", "newest", "oldest", "name"];
export const DEFAULT_LEAD_SORT: LeadSort = "activity";

/** مظلة «مهتم» — كل المتفاعلين (مصدر واحد يشاركه شريط الفلاتر واستعلام «لم يستجب»). */
export const INTEREST_UMBRELLA: LeadStage[] = ["INTERESTED", "VIEWING", "NEGOTIATION", "FOLLOW_UP_LATER"];

/** سبب الأرشفة (فلتر تبويب «مؤرشف»): نهائي / مسوّق / يدوي — فارغ = الكل. */
export type ArchiveReason = "" | "final" | "marketer" | "manual";
const ARCHIVE_REASONS: ArchiveReason[] = ["", "final", "marketer", "manual"];

/** قيم الفلاتر كما في الرابط (مشتركة بين جدول العملاء والكانبان). nr = فلتر «لم يستجب» (مدير فقط). */
export type LeadFilterValues = { q: string; stages: string[]; emps: string[]; sort: LeadSort; nr: boolean; ar: ArchiveReason };

export type ParsedLeadFilters = {
  q: string;
  stages: LeadStage[];
  assigneeIds: string[];
  includeUnassigned: boolean;
  unresponsive: boolean;
  archiveReason: ArchiveReason;
  sort: LeadSort;
  values: LeadFilterValues;
};

/** بناء سلسلة استعلام GET /api/leads من التبويب + الفلاتر. (working = الافتراضي بلا بارامتر). */
export function buildLeadsQuery(tab: "working" | "archived" | "hidden" | "unassigned" | "all", v: LeadFilterValues): string {
  const p = new URLSearchParams();
  if (tab !== "working") p.set("tab", tab);
  if (v.q) p.set("q", v.q);
  if (v.stages.length) p.set("stages", v.stages.join(","));
  if (v.emps.length) p.set("emps", v.emps.join(","));
  if (v.sort !== DEFAULT_LEAD_SORT) p.set("sort", v.sort); // نظافة الرابط: الافتراضي بلا بارامتر
  if (v.nr) p.set("nr", "1"); // فلتر «لم يستجب» — للمالك/المدير
  if (v.ar) p.set("ar", v.ar); // فلتر سبب الأرشفة (تبويب «مؤرشف»)
  return p.toString();
}

/** تحويل searchParams إلى فلاتر موحّدة — يستخدمه الجدول والكانبان و GET /api/leads. */
export function parseLeadFilters(sp: { q?: string; stages?: string; emps?: string; sort?: string; nr?: string; ar?: string }): ParsedLeadFilters {
  const q = sp.q ?? "";
  // #32: نصفّي القيم على أعضاء LeadStage — أي قيمة خاطئة في الرابط تُتجاهل بدل ٥٠٠.
  const stages = (sp.stages ? sp.stages.split(",").filter(Boolean) : []).filter((s): s is LeadStage => s in LeadStage);
  const empTokens = sp.emps ? sp.emps.split(",").filter(Boolean) : [];
  const includeUnassigned = empTokens.includes("none");
  const assigneeIds = empTokens.filter((t) => t !== "none");
  // ترتيب: أي قيمة غير مسموحة → الافتراضي activity.
  const sort: LeadSort = LEAD_SORTS.includes(sp.sort as LeadSort) ? (sp.sort as LeadSort) : DEFAULT_LEAD_SORT;
  const unresponsive = sp.nr === "1";
  const archiveReason: ArchiveReason = ARCHIVE_REASONS.includes(sp.ar as ArchiveReason) ? (sp.ar as ArchiveReason) : "";
  return { q, stages, assigneeIds, includeUnassigned, unresponsive, archiveReason, sort, values: { q, stages, emps: empTokens, sort, nr: unresponsive, ar: archiveReason } };
}
