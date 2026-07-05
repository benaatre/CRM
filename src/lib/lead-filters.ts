import { LeadStage } from "@prisma/client";

/** قيم الفلاتر كما في الرابط (مشتركة بين جدول العملاء والكانبان). */
export type LeadFilterValues = { q: string; stages: string[]; emps: string[] };

export type ParsedLeadFilters = {
  q: string;
  stages: LeadStage[];
  assigneeIds: string[];
  includeUnassigned: boolean;
  values: LeadFilterValues;
};

/** بناء سلسلة استعلام GET /api/leads من التبويب + الفلاتر. (working = الافتراضي بلا بارامتر). */
export function buildLeadsQuery(tab: "working" | "archived" | "hidden" | "unassigned" | "all", v: LeadFilterValues): string {
  const p = new URLSearchParams();
  if (tab !== "working") p.set("tab", tab);
  if (v.q) p.set("q", v.q);
  if (v.stages.length) p.set("stages", v.stages.join(","));
  if (v.emps.length) p.set("emps", v.emps.join(","));
  return p.toString();
}

/** تحويل searchParams إلى فلاتر موحّدة — يستخدمه الجدول والكانبان و GET /api/leads. */
export function parseLeadFilters(sp: { q?: string; stages?: string; emps?: string }): ParsedLeadFilters {
  const q = sp.q ?? "";
  // #32: نصفّي القيم على أعضاء LeadStage — أي قيمة خاطئة في الرابط تُتجاهل بدل ٥٠٠.
  const stages = (sp.stages ? sp.stages.split(",").filter(Boolean) : []).filter((s): s is LeadStage => s in LeadStage);
  const empTokens = sp.emps ? sp.emps.split(",").filter(Boolean) : [];
  const includeUnassigned = empTokens.includes("none");
  const assigneeIds = empTokens.filter((t) => t !== "none");
  return { q, stages, assigneeIds, includeUnassigned, values: { q, stages, emps: empTokens } };
}
