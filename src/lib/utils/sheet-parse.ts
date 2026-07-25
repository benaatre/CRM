// تحليل صفوف جوجل شيت — منطق نقي (بدون googleapis) قابل للاختبار والاستيراد في أي مكان.
import type { PurchaseMethod, PurchaseGoal } from "@prisma/client";
import { normalizePhone, normalizePurchaseGoal } from "../value-normalize";

/** توحيد عربي بسيط (إزالة تشكيل + توحيد الألف/الياء/التاء + تصغير). */
function norm(s: string): string {
  return String(s ?? "")
    .replace(/[ـً-ْ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** تنظيف القيم المتسخة: يحذف الأقواس {} واللاحقة :true/:false والرموز الزائدة. */
function cleanValue(v: string | undefined | null): string {
  if (v == null) return "";
  let s = String(v).trim();
  s = s.replace(/[{}]/g, "");                     // أقواس
  s = s.replace(/\s*:\s*(true|false)\s*$/i, "");   // :true/:false في النهاية
  s = s.replace(/\s*:\s*(true|false)\b/gi, "");    // أو في أي مكان
  return s.replace(/\s+/g, " ").trim();
}

/**
 * فكّ صيغة الخرائط المنطقية من نماذج الإعلانات: {للسكن:true} / {الاستثمار:false، الاثنين معاً:true}
 * — تُبقي مفاتيح true فقط (cleanValue القديمة كانت تُبقي مفاتيح false أيضًا فتُحسب غلطًا).
 * القيم بلا true/false تمرّ كما هي.
 */
function unwrapBooleanMap(raw: string): string {
  if (!/[:=]\s*(true|false)\b/i.test(raw)) return raw;
  const trueKeys: string[] = [];
  for (const m of String(raw).matchAll(/([^{}،,:=]+)\s*[:=]\s*(true|false)\b/gi)) {
    if (m[2].toLowerCase() === "true") trueKeys.push(m[1].trim());
  }
  return trueKeys.join("، ");
}

/** تنظيف الاسم من رموز اليونيكود الزائدة (تشكيل عربي، شطب/علامات دامجة، محارف صفرية). */
function cleanName(v: string | null | undefined): string {
  return cleanValue(v)
    .normalize("NFC")
    // تشكيل عربي + تطويل + علامات دامجة لاتينية (الشطب U+0336 ضمنها)
    .replace(/[\u0300-\u036F\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    // محارف صفرية العرض / تحكم الاتجاه
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** مطابقة طريقة الشراء مع القيم الأربع المعتمدة — أو null إن لم تطابق. */
function matchPurchaseMethod(raw: string | null | undefined): PurchaseMethod | null {
  const s = norm(cleanValue(raw ?? ""));
  if (!s) return null;
  const hasCash = /كاش|نقد/.test(s);
  const hasFinance = /تمويل|بنك/.test(s);
  // «الاثنين معاً» = هدف (سكن+استثمار)، مو طريقة شراء — فلا نطابقه هنا.
  if (hasCash && hasFinance) return "CASH_AND_FINANCE";
  if (hasFinance && /غير مدعوم/.test(s)) return "BANK_FINANCE_UNSUPPORTED";
  if (hasFinance && /مدعوم/.test(s)) return "BANK_FINANCE_SUPPORTED";
  if (hasCash) return "CASH";
  if (hasFinance) return "BANK_FINANCE"; // تمويل بنكي مجرّد (بدون مدعوم/غير) → القديم
  return null;
}

// قائمة أحياء أساسية (قابلة للتوسّع) — للتعرّف على قيمة «حي» بمحتواها.
const KNOWN_DISTRICTS = [
  "المهدية", "ظهرة لبن", "لبن", "النرجس", "الملقا", "الياسمين", "الورود", "الربيع",
  "العارض", "القيروان", "حطين", "الصحافة", "النخيل", "المونسية", "اشبيليه", "الرمال",
  "قرطبة", "الحمراء", "السلي", "المروج", "الغدير", "الوادي", "النزهة", "الملز",
  "العليا", "السليمانية", "طويق", "ديراب", "عرقة", "المهدية",
].map((d) => norm(d));

/** قيمة «حي»: تبدأ بكلمة «حي» أو تطابق اسم حي معروف أو صيغة «جميع الأحياء». */
function isDistrictValue(raw: string | null | undefined): boolean {
  const s = norm(cleanValue(raw ?? ""));
  if (!s) return false;
  if (/(^|\s)حي(\s|$)/.test(s)) return true;
  if (ALL_AREAS_RE.test(s)) return true;
  return KNOWN_DISTRICTS.some((d) => d && s.includes(d));
}

// ===================== تطبيع الحي → الأحياء المناسبة (preferredAreas) =====================

// الأحياء الثلاثة المعتمدة (نفس القيم اللي يعبّيها الموظف يدويًا في ملف العميل).
export const AREA_MAHDIA = "الرياض المهدية";
export const AREA_DHAHRAT_LABAN = "الرياض ظهرة لبن";
export const AREA_AHMADIA = "الرياض الأحمدية";
export const ALL_AREAS = [AREA_MAHDIA, AREA_DHAHRAT_LABAN, AREA_AHMADIA];

// «جميع الأحياء / الثلاثة / كلها / الكل» — كقيمة كاملة (لا كجزء من جملة أخرى).
const ALL_AREAS_RE = /^(جميع( الاحياء)?|الثلاثه|كلها|الكل)$/;

export type AreasParse = { areas: string[]; note: string | null };

/**
 * قاموس تطبيع الحي (مطابقة مرنة — norm يوحّد الهمزات والتاء المربوطة، ونتجاهل
 * «ال» التعريف وكلمة «الرياض» وكلمة «حي» والمسافات الزائدة):
 *   ظهرة لبن ← الرياض ظهرة لبن · المهدية ← الرياض المهدية ·
 *   الأحمدية/لبن الشرقي ← الرياض الأحمدية · جميع/الثلاثة/كلها ← الثلاثة معًا ·
 *   غير ذلك ← «أخرى» + النص الخام في ملاحظة (لا تخمين).
 */
export function normalizeAreas(raw: string): AreasParse {
  const original = cleanValue(raw);
  // norm ثم إزالة «الرياض» و«حي» ككلمات مستقلة.
  const s = norm(original).replace(/(^|\s)(الرياض|حي)(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  if (ALL_AREAS_RE.test(s)) return { areas: [...ALL_AREAS], note: null };

  const areas: string[] = [];
  // «لبن الشرقي» = الأحمدية — تُلتقط وتُشال قبل فحص «لبن» العام (وإلا حُسبت ظهرة لبن غلط).
  let rest = s;
  if (/لبن\s*الشرقي|احمديه/.test(rest)) {
    areas.push(AREA_AHMADIA);
    rest = rest.replace(/لبن\s*الشرقي/g, " ");
  }
  if (/مهديه/.test(rest)) areas.push(AREA_MAHDIA);
  if (/ظهره\s*لبن|(^|\s)لبن(?=\s|$)/.test(rest)) areas.push(AREA_DHAHRAT_LABAN);

  if (areas.length > 0) {
    // بترتيب العرض المعتمد (المهدية · ظهرة لبن · الأحمدية).
    return { areas: ALL_AREAS.filter((a) => areas.includes(a)), note: null };
  }
  return { areas: ["أخرى"], note: `الحي (من الشيت): ${original}` };
}

// ===================== الميزانية / السعر من–إلى =====================

export type BudgetParse = { min: number | null; max: number | null; note: string | null };

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function latinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

// مضاعف الوحدة: ألف/k ×١٠٠٠ · مليون/م ×١٠٠٠٠٠٠ (norm: ألف→الف).
const UNIT_RE = "(الف|مليون|k|م)";
function unitMul(u: string | undefined): number | null {
  if (!u) return null;
  return u === "مليون" || u === "م" ? 1_000_000 : 1_000;
}
// أرقام عارية بلا وحدة: أقل من ١٠ آلاف = بالآلاف ضمنًا (ميزانية عقار ما تنزل عن ١٠ آلاف ريال).
function bareFix(v: number): number {
  return v < 10_000 ? v * 1_000 : v;
}
const NUM = "(\\d+(?:[.,]\\d+)?)";
const num = (s: string) => parseFloat(s.replace(",", "."));

/**
 * تحليل قيمة ميزانية/سعر من الشيت:
 *   «600-800» و«من 600 الى 800 الف» ← من/إلى · «حتى مليون»/«أقل من X» ← إلى فقط ·
 *   رقم واحد ← إلى (سقف الميزانية) · نص فيه كلمات سعرية بلا رقم مفهوم ← ملاحظة خام بلا تخمين.
 * ترجع null لو القيمة ليست ميزانية أصلًا (فلا تُصنَّف budget).
 */
export function parseBudgetValue(raw: string): BudgetParse | null {
  const original = cleanValue(raw);
  const s = norm(latinDigits(original)).replace(/ريال|ر\.س/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;

  // من X إلى Y (أو X-Y): الوحدة على أيٍّ من الطرفين تسري على الاثنين.
  const range = s.match(new RegExp(`${NUM}\\s*${UNIT_RE}?\\s*(?:-|–|—|الي|to)\\s*${NUM}\\s*${UNIT_RE}?`));
  if (range) {
    const m1u = unitMul(range[2]) ?? unitMul(range[4]);
    const m2u = unitMul(range[4]) ?? unitMul(range[2]);
    let lo = num(range[1]) * (m1u ?? 1);
    let hi = num(range[3]) * (m2u ?? 1);
    if (m1u == null && m2u == null) { lo = bareFix(lo); hi = bareFix(hi); }
    if (lo > hi) [lo, hi] = [hi, lo];
    return { min: Math.round(lo), max: Math.round(hi), note: null };
  }

  // «حتى X» / «أقل من X» / «بحدود X» — والرقم اختياري («حتى مليون» = ١ مليون).
  const upTo = s.match(new RegExp(`(?:حتي|اقل من|لا يتجاوز|بحدود|ما يتعدي)\\s*${NUM}?\\s*${UNIT_RE}?`));
  if (upTo && (upTo[1] || upTo[2])) {
    const u = unitMul(upTo[2]);
    let v = (upTo[1] ? num(upTo[1]) : 1) * (u ?? 1);
    if (u == null) v = bareFix(v);
    return { min: null, max: Math.round(v), note: null };
  }

  // «من X» فقط (بلا إلى) ← من.
  const fromOnly = s.match(new RegExp(`^من\\s*${NUM}\\s*${UNIT_RE}?$`));
  if (fromOnly) {
    const u = unitMul(fromOnly[2]);
    let v = num(fromOnly[1]) * (u ?? 1);
    if (u == null) v = bareFix(v);
    return { min: Math.round(v), max: null, note: null };
  }

  // رقم واحد ← إلى (سقف الميزانية). بوحدة: دائمًا. عاري: ٥–٨ خانات فقط
  // (أقصر = غامض، أطول/١٠ خانات = هوية أو جوال — لا تخمين).
  const single = s.match(new RegExp(`^${NUM}\\s*${UNIT_RE}?$`));
  if (single) {
    const u = unitMul(single[2]);
    if (u != null) return { min: null, max: Math.round(num(single[1]) * u), note: null };
    const digits = single[1].replace(/\D/g, "");
    if (digits.length >= 5 && digits.length <= 8) return { min: null, max: Math.round(num(single[1])), note: null };
    return null;
  }

  // فيه كلمات سعرية لكن الصيغة غير مفهومة ← ملاحظة خام بلا تخمين.
  if (/سعر|ميزانيه|الف|مليون/.test(s) && /\d/.test(s)) {
    return { min: null, max: null, note: `الميزانية (من الشيت): ${original}` };
  }
  return null;
}

// ===================== تحليل الأعمدة (الرؤوس + تكرار القيم) =====================

export type ColumnRole = {
  /** رأس إعلاني (campaign/ad/form/squad/account/id/إعلان/حملة) — ليس بيانات عميل أبدًا: يُتجاهل كليًا. */
  excluded: boolean;
  /** رأس اسم صريح (name/الاسم/first/last/الأول/الأخير) — المعتمد للاسم بأولوية قاطعة. */
  nameHeader: boolean;
  /** رأس سعر صريح (سعر/ميزانية/budget/price/مبلغ) — الوحيد الذي يُقبل منه رقم عارٍ سعرًا. */
  priceHeader: boolean;
  /** قيمه متكررة (نفس النص في >٥٠٪ من الصفوف) — نص حملة/قالب، لا يصلح اسمًا. */
  repetitive: boolean;
};

// رؤوس مستبعدة صراحة — أعمدة الإعلانات (تُفحص قبل رؤوس الاسم: campaignName فيه name لكنه حملة).
const EXCLUDED_HEADER_RE = /campaign|حمل[هة]|اعلان|adset|ad ?name|ad_name|squad|form|account|id$|(^|[^a-z])(ad|id)([^a-z]|$)/;
// رؤوس الاسم المعتمدة.
const NAME_HEADER_RE = /name|first|last|(^|\s)ال?اسم(\s|$)|الاول|الاخير|العائل/;
// رؤوس السعر الصريحة — الوحيدة التي يُقبل منها رقم عارٍ بلا سياق سعري.
const PRICE_HEADER_RE = /سعر|ميزاني|budget|price|مبلغ/;

/**
 * قفل السعر الجذري (حادثة «7asan S.»: 2000–2026000 التُقطا من نص حملة «شهر 6/2026 - 2»):
 * قيمة بلا رأس سعر تُقبل سعرًا فقط لو نصّها سعري صريح — كلمة سعرية (سعر/ميزانية/ريال/حتى/
 * بحدود…) أو وحدة (ألف/مليون ككلمة مستقلة) أو صيغة «من X إلى Y». رقم عارٍ أو نطاق أرقام
 * بلا سياق (تاريخ/معرّف/نص إعلاني) = لا التقاط قطعًا.
 */
export function hasPriceContext(raw: string): boolean {
  const s = norm(latinDigits(String(raw ?? "")));
  if (!/\d/.test(s)) return /حتي مليون|بحدود مليون/.test(s); // «حتى مليون» بلا رقم
  if (/ريال|ر\.س|سعر|ميزانيه|بحدود|حتي|اقل من|لا يتجاوز|ما يتعدي/.test(s)) return true;
  if (/(^|\s)(الف|مليون|k|م)(\s|$)/.test(s)) return true; // وحدة سعرية ككلمة مستقلة بجانب رقم
  if (/من\s*[\d.,]+\s*(الف|مليون)?\s*(الي|to)\s*[\d.,]+/.test(s)) return true; // من X إلى Y
  return false;
}

/**
 * يحلّل أعمدة الورقة مرة واحدة: دور كل عمود من رأسه + تكرار قيمه.
 * الجذر لخلل «اسم الحملة صار اسم العميل»: الورقة فيها أعمدة نصية كثيرة
 * (campaignName · adName · formName…) والتصنيف المحتوائي وحده يلقط الغلط.
 */
export function analyzeColumns(header: string[], data: string[][]): ColumnRole[] {
  const width = Math.max(header.length, ...data.map((r) => r.length), 0);
  const roles: ColumnRole[] = [];
  for (let c = 0; c < width; c++) {
    const h = norm(String(header[c] ?? ""));
    const excluded = !!h && EXCLUDED_HEADER_RE.test(h);
    const nameHeader = !excluded && !!h && NAME_HEADER_RE.test(h);
    const priceHeader = !excluded && !!h && PRICE_HEADER_RE.test(h);
    // التكرار: عيّنة حتى ١٠٠ صف، ولا حكم بأقل من ٥ قيم غير فارغة (عيّنة «جرّب الاتصال» الصغيرة).
    const vals = data.slice(0, 100).map((r) => String(r[c] ?? "").trim()).filter(Boolean);
    let repetitive = false;
    if (vals.length >= 5) {
      const counts = new Map<string, number>();
      for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
      repetitive = Math.max(...counts.values()) / vals.length > 0.5;
    }
    roles.push({ excluded, nameHeader, priceHeader, repetitive });
  }
  return roles;
}

// ===================== التعرّف التلقائي بالمحتوى =====================

/** رقم جوال سعودي صالح بعد التوحيد؟ */
function isSaudiMobile(raw: string | null | undefined): boolean {
  return /^05\d{8}$/.test(normalizePhone(cleanValue(raw ?? "")));
}

/** يحتوي حروفًا (عربي/إنجليزي) وليس رقمًا/رمزًا صرفًا؟ */
function hasLetters(v: string): boolean {
  return /[A-Za-z؀-ۿ]/.test(v) && !/^[\d\s+\-()]+$/.test(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2})?/;

// أعمدة قمامة معروفة في شيتات الإعلانات (More Volume وأخواتها) — ليست أسماء ولا تُكتب في أي مكان.
const JUNK_VALUE_RE = /^(more\s*volume|volume|whatsapp|instagram|facebook|snap\s?chat|tiktok|meta|google|form|leads?|campaign|ad\s?set|adset|ads?|ig|fb)$/i;

/** قيمة تصلح أن تكون «اسم»: حروف، وليست UUID/تاريخ/رقم/طريقة/هدف/قمامة إعلانات. */
function isNameLike(v: string): boolean {
  if (!hasLetters(v)) return false;
  if (UUID_RE.test(v) || DATE_RE.test(v)) return false;
  if (JUNK_VALUE_RE.test(v.trim())) return false;
  if (matchPurchaseMethod(v) || normalizePurchaseGoal(v)) return false;
  return true;
}

/** يشبه جوالًا لكنه غير صالح (أرقام كثيرة بصيغة فوضوية) — يُحفظ خامًا في ملاحظة «جوال غير صالح». */
function looksPhoneLike(clean: string): boolean {
  const digits = clean.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  return /^[\d\s()+\-.]+$/.test(clean) || digits.length >= 9;
}

export type ParsedLead = {
  row: number;                          // رقم الصف في الشيت (1-based، للعرض)
  name: string;
  phone: string;                        // موحّد 05XXXXXXXX — أو "" لو غير صالح (يدخل بملاحظة، لا يُسقط الصف)
  purchaseMethod: PurchaseMethod | null;
  purchaseGoal: PurchaseGoal | null;
  district: string | null;              // النص الخام (للتوافق مع preferredDistrict)
  areas: string[];                      // الأحياء المطبّعة (قاموس) — تُكتب في preferredAreas
  priceMin: number | null;              // السعر من (ريال كامل)
  priceMax: number | null;              // السعر إلى (ريال كامل)
  extraNote: string | null;             // نص خام غير مفهوم (حي/ميزانية/جوال) — بلا تخمين
  valid: boolean;                       // فيه اسم أو جوال — الصف الفارغ منهما معًا فقط يُتخطى
  skip?: string;                        // سبب التخطّي إن وُجد
  rawCells: string[];                   // خلايا الصف الخام — لكاشف الصفوف العصية وطبقة الـAI
};

// ===================== تصنيف كل قيمة بمحتواها (للشيتات المتبعثرة) =====================

export type CellType = "phone" | "method" | "district" | "goal" | "budget" | "name" | "ignore";

/** يصنّف قيمة خلية واحدة حسب محتواها (بعد التنظيف). */
function classifyCell(raw: string | null | undefined): { type: CellType; value: string } {
  const clean = cleanValue(raw ?? "");
  if (!clean) return { type: "ignore", value: "" };
  if (UUID_RE.test(clean) || DATE_RE.test(clean)) return { type: "ignore", value: "" };
  if (isSaudiMobile(clean)) return { type: "phone", value: normalizePhone(clean) };
  // الهدف والحي قبل الطريقة: «الاثنين معاً» هدف (مو طريقة)، والحي أوضح من الطريقة.
  const goal = normalizePurchaseGoal(clean);
  if (goal) return { type: "goal", value: goal };
  if (isDistrictValue(clean)) return { type: "district", value: clean };
  const method = matchPurchaseMethod(clean);
  if (method) return { type: "method", value: method };
  // الميزانية قبل الاسم: «600 الف» فيها حروف وكانت ستُحسب اسمًا.
  if (parseBudgetValue(clean)) return { type: "budget", value: clean };
  if (isNameLike(clean)) return { type: "name", value: clean };
  return { type: "ignore", value: "" };
}

/**
 * يحلّل صفًّا بتصنيف كل خلية بمحتواها (مو بموضعها) — يحلّ مشكلة الأعمدة المتبعثرة.
 * الاسم: أول قيمتين اسم (تُدمجان). طريقة/حي/هدف: أول قيمة صالحة لكل حقل.
 */
function classifyRow(cells: string[], sheetRowNumber: number, roles?: ColumnRole[]): ParsedLead {
  const nameParts: string[] = [];
  let phone = "";
  let phoneInvalidRaw: string | null = null; // نص يشبه الجوال لكنه غير صالح — يُحفظ خامًا في ملاحظة
  let purchaseMethod: PurchaseMethod | null = null;
  let purchaseGoal: PurchaseGoal | null = null;
  let district: string | null = null;
  let budget: BudgetParse | null = null;

  // أولوية (أ) — رؤوس الاسم الصريحة: أول عمودين اسم متجاورين (first/last في ورقة سناب L+M)
  // يُدمجان مباشرة، ولا يُلتقط اسم بالمحتوى إطلاقًا ما دامت رؤوس اسم موجودة.
  const headerNameCols = (roles ?? []).map((r, c) => (r.nameHeader ? c : -1)).filter((c) => c >= 0);
  for (const c of headerNameCols) {
    if (nameParts.length >= 2) break;
    const v = cleanName(cleanValue(unwrapBooleanMap(String(cells[c] ?? ""))));
    if (v && !UUID_RE.test(v) && !DATE_RE.test(v) && !isSaudiMobile(v)) nameParts.push(v);
  }
  const namesFromHeaders = headerNameCols.length > 0;

  for (let colIdx = 0; colIdx < cells.length; colIdx++) {
    const cell = cells[colIdx];
    const role = roles?.[colIdx];
    // عمود إعلاني مستبعد بالرأس (حملة/إعلان/نموذج/حساب/معرّف) — يُتجاهل كليًا:
    // لا اسم ولا حي ولا سعر ولا حتى ملاحظة جوال (معرّفات رقمية طويلة كانت ستُلتقط غلطًا).
    if (role?.excluded) continue;
    // فكّ صيغة {المفتاح:true} أولًا — مفاتيح false تسقط ولا تُصنّف.
    const unwrapped = unwrapBooleanMap(String(cell ?? ""));
    // الخلايا المدمجة («قيمة، قيمة») تُقسّم وتُصنّف كل جزء على حدة —
    // إلا خلية الميزانية: تُفحص كاملة أولًا («من ٦٠٠،٠٠٠ إلى ٨٠٠،٠٠٠» فيها فواصل).
    const whole = cleanValue(unwrapped);
    // قفل السعر: عمود رأسه سعري، أو نص سعري صريح — رقم عارٍ/نطاق بلا سياق لا يُلتقط قطعًا
    // (تواريخ ومعرّفات ونصوص الحملات كانت تنتج أسعارًا وهمية مثل 2000–2026000).
    if (!budget && whole && (role?.priceHeader || hasPriceContext(whole))
        && !UUID_RE.test(whole) && !DATE_RE.test(whole) && !isSaudiMobile(whole)) {
      const b = parseBudgetValue(whole);
      // قيم فعلية فقط — الملاحظة الخام (note) تمرّ بالتصنيف العادي (بعد فحص الطريقة).
      if (b && (b.min != null || b.max != null)) { budget = b; continue; }
    }
    for (const part of unwrapped.split(/[,،]/)) {
      const { type, value } = classifyCell(part);
      if (type === "phone") { if (!phone) phone = value; }
      else if (type === "method") { if (!purchaseMethod) purchaseMethod = value as PurchaseMethod; }
      else if (type === "district") { if (!district) district = value; }
      else if (type === "goal") { if (!purchaseGoal) purchaseGoal = value as PurchaseGoal; }
      // نفس قفل السعر على مستوى الجزء: رأس سعري أو سياق سعري صريح — وإلا لا التقاط.
      else if (type === "budget") { if (!budget && (role?.priceHeader || hasPriceContext(value))) budget = parseBudgetValue(value); }
      // الاسم بالمحتوى: فقط لو ما فيه رؤوس اسم، ومع استبعاد الأعمدة المتكررة القيم
      // (نص الحملة يتكرر في كل الصفوف — ليس اسم عميل).
      else if (type === "name") { if (!namesFromHeaders && !role?.repetitive && nameParts.length < 2) nameParts.push(value); }
      else {
        // جوال بصيغة فوضوية غير صالحة — لا يفجّر الدورة أبدًا: يُحفظ خامًا للملاحظة.
        const clean = cleanValue(part);
        if (!phone && !phoneInvalidRaw && clean && looksPhoneLike(clean)) phoneInvalidRaw = clean;
      }
    }
  }

  const name = cleanName(nameParts.join(" "));
  // القاعدة: الجوال غير الصالح لا يُسقط الصف — يدخل بجوال فارغ + ملاحظة. الصف بلا اسم
  // وبلا جوال معًا هو الوحيد الذي يُتخطى (صف فارغ/قمامة).
  let valid = true;
  let skip: string | undefined;
  if (!name && !phone) { valid = false; skip = "بلا اسم ولا جوال"; }

  // تطبيع الحي بالقاموس + دمج الملاحظات الخام (حي غير معروف / ميزانية غير مفهومة / جوال غير صالح).
  const areasParse: AreasParse = district ? normalizeAreas(district) : { areas: [], note: null };
  const phoneNote = valid && !phone
    ? (phoneInvalidRaw ? `جوال غير صالح: ${phoneInvalidRaw}` : "بلا جوال صالح")
    : null;
  const extraNote = [phoneNote, areasParse.note, budget?.note].filter(Boolean).join(" · ") || null;

  return {
    row: sheetRowNumber, name, phone, purchaseMethod, purchaseGoal, district,
    areas: areasParse.areas,
    priceMin: budget?.min ?? null,
    priceMax: budget?.max ?? null,
    extraNote,
    valid, skip,
    rawCells: cells.map((c) => String(c ?? "")),
  };
}

/**
 * كاشف الصف العصي (مرشّح طبقة الـAI): القواعد عجزت عن الاسم أو الجوال، أو التقطتهما
 * وفي الصف نصٌّ يوحي بهدف/طريقة/حي/سعر لم يُفهم. الصفوف الفارغة كليًا ليست عصية — تُتخطى.
 */
export function isStubbornRow(l: ParsedLead): boolean {
  if (!l.valid) return false;
  if (!l.name || !l.phone) return true;
  const joined = norm(l.rawCells.join(" "));
  if (!l.purchaseGoal && /سكن|استثمار/.test(joined)) return true;
  if (!l.purchaseMethod && /تمويل|كاش|نقد/.test(joined)) return true;
  if (l.areas.length === 0 && /مهديه|احمديه|ظهره|(^|\s)حي\s/.test(joined)) return true;
  if (l.priceMin == null && l.priceMax == null && !l.extraNote && /سعر|ميزانيه|مليون|(^|\s)الف(\s|$)/.test(joined)) return true;
  return false;
}

/** يحلّل قيم الشيت بالتصنيف المحتوائي (كل خلية) — للشيتات المتبعثرة والمنظّمة معًا. */
export function parseRowsByContent(
  values: string[][],
  opts?: { startDataIndex?: number; limit?: number },
): { header: string[]; leads: ParsedLead[]; totalDataRows: number; columnRoles: ColumnRole[] } {
  const header = values[0] ?? [];
  const data = values.slice(1);
  // تحليل الأعمدة مرة واحدة (رؤوس + تكرار) — يُمرَّر لكل صف: رؤوس الاسم أولوية قاطعة،
  // وأعمدة الإعلانات (campaignName…) تُتجاهل كليًا.
  const roles = analyzeColumns(header.map(String), data);
  const start = opts?.startDataIndex ?? 0;
  const slice = opts?.limit != null ? data.slice(start, start + opts.limit) : data.slice(start);
  const leads = slice.map((row, i) => classifyRow(row, start + i + 2, roles));
  return { header, leads, totalDataRows: data.length, columnRoles: roles };
}
