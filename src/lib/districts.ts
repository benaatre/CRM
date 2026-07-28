/**
 * الأحياء الثلاثة المعتمدة — مصدر الحقيقة الوحيد للقيمة المخزَّنة ولنصوص العرض.
 *
 * قاعدة أساسية — التخزين والعرض منفصلان:
 *   • التخزين: الأحياء الفعلية دائمًا (الثلاثة كاملة إن اختار العميل الكل) — كي تشتغل
 *     الفلترة والمطابقة مع المشاريع على قيم حقيقية لا على «الكل».
 *   • العرض: إذا كانت الثلاثة كلها محدَّدة → شارة واحدة «الأحياء الثلاثة تناسبني»؛
 *     حيّان أو أقل → يظهران كما هما بالاسم القصير.
 *
 * القيم المخزَّنة طويلة («الرياض المهدية») — هذه القيم القائمة في القاعدة ومسار الاستيراد،
 * فما نغيّرها. العرض قصير فقط.
 */

export const AREA_MAHDIA = "الرياض المهدية";
export const AREA_DHAHRAT_LABAN = "الرياض ظهرة لبن";
export const AREA_AHMADIA = "الرياض الأحمدية";

/**
 * القيم المخزَّنة بترتيبها المعتمد (تطبيع + تخزين).
 * لا تُغيَّر — بيانات قائمة وسكربتات مقارنة تعتمد هذا الترتيب.
 */
export const ALL_AREAS = [AREA_MAHDIA, AREA_DHAHRAT_LABAN, AREA_AHMADIA];

/** عنوان الحقل كما يُسأل العميل. */
export const DISTRICT_QUESTION = "في أي حي تفضّل التملك؟";

/** نص زر الاختصار وشارة العرض عند تحديد الثلاثة. */
export const ALL_AREAS_LABEL = "الأحياء الثلاثة تناسبني";

/** خيارات الواجهة بترتيب العرض المطلوب: المهدية · الأحمدية · ظهرة لبن. */
export const DISTRICT_OPTIONS: { value: string; label: string }[] = [
  { value: AREA_MAHDIA, label: "المهدية" },
  { value: AREA_AHMADIA, label: "الأحمدية" },
  { value: AREA_DHAHRAT_LABAN, label: "ظهرة لبن" },
];

const SHORT_LABEL = new Map(DISTRICT_OPTIONS.map((o) => [o.value, o.label]));

/** الاسم القصير للعرض — القيم القديمة الحرة تُعاد كما هي بلا مساس. */
export function shortAreaLabel(value: string): string {
  return SHORT_LABEL.get(value) ?? value;
}

/** هل الأحياء الثلاثة كلها محدَّدة؟ */
export function hasAllAreas(areas: string[]): boolean {
  return ALL_AREAS.every((a) => areas.includes(a));
}

/**
 * ترتيب قانوني للتخزين: الأحياء المعتمدة أولًا بترتيب ALL_AREAS، ثم أي قيمة قديمة حرة كما هي.
 * يضمن أن مصفوفة العميل ثابتة الشكل مهما كان ترتيب ضغط الأزرار.
 */
export function canonicalAreas(areas: string[]): string[] {
  const uniq = [...new Set(areas)];
  return [...ALL_AREAS.filter((a) => uniq.includes(a)), ...uniq.filter((a) => !ALL_AREAS.includes(a))];
}

/**
 * شارات العرض: الثلاثة كلها → شارة واحدة «الأحياء الثلاثة تناسبني» (تليها أي قيم قديمة
 * حرة كما هي). غير ذلك → كل حي باسمه القصير.
 */
export function areaBadges(areas: string[]): string[] {
  if (areas.length === 0) return [];
  if (!hasAllAreas(areas)) return areas.map(shortAreaLabel);
  return [ALL_AREAS_LABEL, ...areas.filter((a) => !ALL_AREAS.includes(a))];
}
