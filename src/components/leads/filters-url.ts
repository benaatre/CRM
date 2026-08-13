import {
  DEFAULT_LEAD_SORT, collapseStagesParam, dateRangeApplies, type LeadFilterValues,
} from "@/lib/lead-filters";

type Tab = "working" | "archived" | "hidden" | "unassigned";

/**
 * رابط قائمة العملاء بعد تغيير فلتر — **مصدر واحد** يشاركه اللوح الجانبي وشريط
 * الأدوات، فلا ينحرف أحدهما عن الآخر (مثلًا يُسقِط `ar` أو يُبقي نطاقًا زمنيًا ميتًا).
 * نفس مفاتيح lead-filters حرفيًا — لا مفتاح جديد ولا قيمة مخترعة.
 */
export function buildLeadsHref(
  basePath: string, tab: Tab, filters: LeadFilterValues, next: Partial<LeadFilterValues>,
): string {
  const p = new URLSearchParams();
  if (tab !== "working") p.set("tab", tab);
  const q = next.q ?? filters.q;
  if (q) p.set("q", q);
  const stages = next.stages ?? filters.stages;
  if (stages.length) p.set("stages", collapseStagesParam(stages).join(",")); // زوج الزيارة ⟵ "visit"
  const emps = next.emps ?? filters.emps;
  if (emps.length) p.set("emps", emps.join(","));
  const sort = next.sort ?? filters.sort;
  if (sort !== DEFAULT_LEAD_SORT) p.set("sort", sort); // نظافة الرابط: الافتراضي بلا بارامتر
  const wait = next.wait ?? filters.wait;
  if (wait) p.set("wait", "1");
  const tr = next.tr ?? filters.tr;
  if (tr) p.set("tr", "1");
  const bank = next.bank ?? filters.bank;
  if (bank) p.set("bank", "1");
  const ar = next.ar ?? filters.ar;
  if (tab === "hidden" && ar) p.set("ar", ar); // سبب الأرشفة خاص بتبويب «مؤرشف»
  // النطاق الزمني يُحمل ما دام فلتر «زيارة»/«موعد لاحق» مفعّلًا (يتصفّر مع إلغائه).
  if (dateRangeApplies(stages)) {
    const range = next.range ?? filters.range;
    const from = next.from ?? filters.from;
    const to = next.to ?? filters.to;
    if (range) p.set("range", range);
    else { if (from) p.set("from", from); if (to) p.set("to", to); }
  }
  const s = p.toString();
  return s ? `${basePath}?${s}` : basePath;
}
