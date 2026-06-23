import type { LeadStage } from "@prisma/client";

/** قيم الفلاتر كما في الرابط (مشتركة بين جدول العملاء والكانبان). */
export type LeadFilterValues = { q: string; stages: string[]; emps: string[] };

export type ParsedLeadFilters = {
  q: string;
  stages: LeadStage[];
  assigneeIds: string[];
  includeUnassigned: boolean;
  values: LeadFilterValues;
};

/** تحويل searchParams إلى فلاتر موحّدة — يستخدمه الجدول والكانبان و GET /api/leads. */
export function parseLeadFilters(sp: { q?: string; stages?: string; emps?: string }): ParsedLeadFilters {
  const q = sp.q ?? "";
  const stages = (sp.stages ? sp.stages.split(",").filter(Boolean) : []) as LeadStage[];
  const empTokens = sp.emps ? sp.emps.split(",").filter(Boolean) : [];
  const includeUnassigned = empTokens.includes("none");
  const assigneeIds = empTokens.filter((t) => t !== "none");
  return { q, stages, assigneeIds, includeUnassigned, values: { q, stages, emps: empTokens } };
}
