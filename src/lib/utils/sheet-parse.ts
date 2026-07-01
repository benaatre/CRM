// تحليل صفوف جوجل شيت — منطق نقي (بدون googleapis) قابل للاختبار والاستيراد في أي مكان.
import type { PurchaseMethod, PurchaseGoal } from "@prisma/client";
import { normalizePhone, normalizePurchaseGoal } from "../value-normalize";

// مرادفات عناوين الأعمدة (مطابقة مرنة بالاسم/المحتوى، مو بالترتيب).
// الترتيب مهم: الحقول المحدّدة (الاسم الأول/الثاني) قبل «الاسم» العام حتى لا يبتلعها.
const FIELD_ALIASES = {
  firstName: ["الاسم الاول", "الاسم اول", "الاول", "first name", "first"],
  lastName: ["الاسم الثاني", "الاسم الاخير", "الثاني", "الاخير", "العائله", "اسم العائله", "last name", "last"],
  name: ["الاسم الكامل", "الاسم", "اسم", "name", "full name", "fullname"],
  phone: ["رقم الجوال", "رقم الهاتف", "رقم العميل", "رقم العميل", "الجوال", "الجوّال", "الهاتف", "جوال", "الرقم", "phone", "mobile", "phone number"],
  purchaseMethod: ["طريقة الشراء", "طريقة الدفع", "purchase method", "payment method"],
  purchaseGoal: ["هدف الشراء", "الهدف", "purchase goal"],
  district: ["الحي المناسب", "الحي المفضل", "الحي", "المنطقه", "district", "area"],
} as const;

type Field = keyof typeof FIELD_ALIASES;

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
export function cleanValue(v: string | undefined | null): string {
  if (v == null) return "";
  let s = String(v).trim();
  s = s.replace(/[{}]/g, "");                     // أقواس
  s = s.replace(/\s*:\s*(true|false)\s*$/i, "");   // :true/:false في النهاية
  s = s.replace(/\s*:\s*(true|false)\b/gi, "");    // أو في أي مكان
  return s.replace(/\s+/g, " ").trim();
}

/** تنظيف الاسم من رموز اليونيكود الزائدة (تشكيل عربي، شطب/علامات دامجة، محارف صفرية). */
export function cleanName(v: string | null | undefined): string {
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
export function matchPurchaseMethod(raw: string | null | undefined): PurchaseMethod | null {
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

/** قيمة «حي»: تبدأ بكلمة «حي» أو تطابق اسم حي معروف. */
export function isDistrictValue(raw: string | null | undefined): boolean {
  const s = norm(cleanValue(raw ?? ""));
  if (!s) return false;
  if (/(^|\s)حي(\s|$)/.test(s)) return true;
  return KNOWN_DISTRICTS.some((d) => d && s.includes(d));
}

export type HeaderMap = Partial<Record<Field, number>>;

/** يطابق صف العناوين بأعمدة الحقول (أول تطابق يفوز). */
export function matchHeaders(header: string[]): HeaderMap {
  const map: HeaderMap = {};
  header.forEach((cell, idx) => {
    const h = norm(cleanValue(cell));
    if (!h) return;
    for (const field of Object.keys(FIELD_ALIASES) as Field[]) {
      if (map[field] !== undefined) continue;
      if (FIELD_ALIASES[field].some((a) => { const n = norm(a); return h === n || h.includes(n); })) {
        map[field] = idx;
        break;
      }
    }
  });
  return map;
}

// ===================== التعرّف التلقائي بالمحتوى =====================

/** رقم جوال سعودي صالح بعد التوحيد؟ */
export function isSaudiMobile(raw: string | null | undefined): boolean {
  return /^05\d{8}$/.test(normalizePhone(cleanValue(raw ?? "")));
}

/** يحتوي حروفًا (عربي/إنجليزي) وليس رقمًا/رمزًا صرفًا؟ */
function hasLetters(v: string): boolean {
  return /[A-Za-z؀-ۿ]/.test(v) && !/^[\d\s+\-()]+$/.test(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2})?/;

/** قيمة تصلح أن تكون «اسم»: حروف، وليست UUID/تاريخ/رقم/طريقة/هدف. */
function isNameLike(v: string): boolean {
  if (!hasLetters(v)) return false;
  if (UUID_RE.test(v) || DATE_RE.test(v)) return false;
  if (matchPurchaseMethod(v) || normalizePurchaseGoal(v)) return false;
  return true;
}

type Scores = { phone: number; method: number; goal: number; name: number; district: number };

/** نِسب نوع القيم في عمود (من عيّنة) — لتحديد نوعه بالمحتوى. */
function columnScores(sample: string[]): Scores {
  const vals = sample.map(cleanValue).filter((v) => v !== "");
  const n = vals.length;
  if (n === 0) return { phone: 0, method: 0, goal: 0, name: 0, district: 0 };
  let phone = 0, method = 0, goal = 0, name = 0, district = 0;
  for (const v of vals) {
    if (isSaudiMobile(v)) phone++;
    if (matchPurchaseMethod(v)) method++;
    if (normalizePurchaseGoal(v)) goal++;
    if (isNameLike(v)) name++;
    if (hasLetters(v) && /(^|\s)حي(\s|$)|ضاحيه|مخطط|منطقه/.test(v)) district++;
  }
  return { phone: phone / n, method: method / n, goal: goal / n, name: name / n, district: district / n };
}

export type DetectedColumns = {
  phone?: number;
  name?: number;
  name2?: number;
  purchaseMethod?: number;
  purchaseGoal?: number;
  district?: number;
};

/**
 * تعرّف تلقائي على أعمدة الشيت بالمحتوى (مع تلميح من العناوين) — يعمل حتى لو
 * العناوين بلا معنى («Column 9»). الجوال/طريقة الشراء/الهدف بالمحتوى؛ الاسم يُفضّل
 * تلميح العنوان ثم يقع على الأعمدة النصّية.
 */
export function detectColumns(header: string[], dataSample: string[][]): { cols: DetectedColumns; scores: Scores[] } {
  const hints = matchHeaders(header);
  const ncols = Math.max(header.length, ...dataSample.map((r) => r.length), 0);
  const scores: Scores[] = [];
  for (let c = 0; c < ncols; c++) scores[c] = columnScores(dataSample.map((r) => r[c] ?? ""));

  const used = new Set<number>();
  const cols: DetectedColumns = {};
  const take = (c: number | undefined) => { if (c !== undefined) used.add(c); };

  // يختار العمود الأعلى نسبةً لمفتاح معيّن فوق العتبة، مع تفضيل تلميح العنوان إن كان محتواه يدعمه.
  const pick = (key: keyof Scores, min: number, hint?: number): number | undefined => {
    if (hint !== undefined && !used.has(hint) && scores[hint][key] >= Math.min(min, 0.3)) return hint;
    let best: number | undefined; let bv = min - 1e-6;
    for (let c = 0; c < ncols; c++) { if (used.has(c)) continue; if (scores[c][key] > bv) { bv = scores[c][key]; best = c; } }
    return best;
  };

  cols.phone = pick("phone", 0.5, hints.phone); take(cols.phone);
  cols.purchaseMethod = pick("method", 0.4, hints.purchaseMethod); take(cols.purchaseMethod);
  cols.purchaseGoal = pick("goal", 0.4, hints.purchaseGoal); take(cols.purchaseGoal);

  // الحي: نصّي فيه إشارة «حي» (وإلا نتركه تفاديًا للخطأ).
  {
    let best: number | undefined; let bv = 0.25;
    for (let c = 0; c < ncols; c++) { if (used.has(c)) continue; if (scores[c].district > bv) { bv = scores[c].district; best = c; } }
    if (best === undefined && hints.district !== undefined && !used.has(hints.district) && scores[hints.district].name >= 0.5) best = hints.district;
    cols.district = best; take(cols.district);
  }

  // الاسم: تلميح العنوان أولًا (اسم/أول/أخير)، وإلا أعمدة الأسماء (تستثني UUID/تاريخ).
  const nameHints = [hints.name, hints.firstName, hints.lastName].filter((c): c is number => c !== undefined && !used.has(c));
  let nameCols: number[];
  if (nameHints.length) {
    nameCols = nameHints.slice(0, 2);
  } else {
    nameCols = [];
    for (let c = 0; c < ncols; c++) { if (used.has(c)) continue; if (scores[c].name >= 0.6) nameCols.push(c); }
    nameCols = nameCols.slice(0, 2);
  }
  cols.name = nameCols[0];
  cols.name2 = nameCols[1];
  return { cols, scores };
}

export type ParsedLead = {
  row: number;                          // رقم الصف في الشيت (1-based، للعرض)
  name: string;
  phone: string;                        // موحّد 05XXXXXXXX
  purchaseMethod: PurchaseMethod | null;
  purchaseGoal: PurchaseGoal | null;
  district: string | null;
  valid: boolean;                       // اسم موجود + رقم صالح
  skip?: string;                        // سبب التخطّي إن وُجد
};

/** يحلّل صفًّا واحدًا حسب الأعمدة المكتشفة. */
export function parseRow(row: string[], cols: DetectedColumns, sheetRowNumber: number): ParsedLead {
  const get = (c: number | undefined) => (c !== undefined ? cleanValue(row[c]) : "");
  // الاسم: عمود واحد، أو دمج عمودين (أول + ثاني/عائلة).
  let name = get(cols.name);
  const n2 = cols.name2 !== undefined && cols.name2 !== cols.name ? get(cols.name2) : "";
  if (n2) name = [name, n2].filter(Boolean).join(" ").trim();
  const phone = normalizePhone(get(cols.phone));
  const purchaseMethod = matchPurchaseMethod(get(cols.purchaseMethod));
  const purchaseGoal = normalizePurchaseGoal(get(cols.purchaseGoal));
  const district = get(cols.district) || null;

  let valid = true;
  let skip: string | undefined;
  if (!name) { valid = false; skip = "الاسم فاضي"; }
  else if (!/^05\d{8}$/.test(phone)) { valid = false; skip = "رقم غير صالح"; }

  return { row: sheetRowNumber, name, phone, purchaseMethod, purchaseGoal, district, valid, skip };
}

// ===================== تصنيف كل قيمة بمحتواها (للشيتات المتبعثرة) =====================

export type CellType = "phone" | "method" | "district" | "goal" | "name" | "ignore";

/** يصنّف قيمة خلية واحدة حسب محتواها (بعد التنظيف). */
export function classifyCell(raw: string | null | undefined): { type: CellType; value: string } {
  const clean = cleanValue(raw ?? "");
  if (!clean) return { type: "ignore", value: "" };
  if (isSaudiMobile(clean)) return { type: "phone", value: normalizePhone(clean) };
  // الهدف والحي قبل الطريقة: «الاثنين معاً» هدف (مو طريقة)، والحي أوضح من الطريقة.
  const goal = normalizePurchaseGoal(clean);
  if (goal) return { type: "goal", value: goal };
  if (isDistrictValue(clean)) return { type: "district", value: clean };
  const method = matchPurchaseMethod(clean);
  if (method) return { type: "method", value: method };
  if (isNameLike(clean)) return { type: "name", value: clean };
  return { type: "ignore", value: "" };
}

/**
 * يحلّل صفًّا بتصنيف كل خلية بمحتواها (مو بموضعها) — يحلّ مشكلة الأعمدة المتبعثرة.
 * الاسم: أول قيمتين اسم (تُدمجان). طريقة/حي/هدف: أول قيمة صالحة لكل حقل.
 */
export function classifyRow(cells: string[], sheetRowNumber: number): ParsedLead {
  const nameParts: string[] = [];
  let phone = "";
  let purchaseMethod: PurchaseMethod | null = null;
  let purchaseGoal: PurchaseGoal | null = null;
  let district: string | null = null;

  for (const cell of cells) {
    // الخلايا المدمجة («قيمة، قيمة») تُقسّم وتُصنّف كل جزء على حدة.
    for (const part of String(cell ?? "").split(/[,،]/)) {
      const { type, value } = classifyCell(part);
      if (type === "phone") { if (!phone) phone = value; }
      else if (type === "method") { if (!purchaseMethod) purchaseMethod = value as PurchaseMethod; }
      else if (type === "district") { if (!district) district = value; }
      else if (type === "goal") { if (!purchaseGoal) purchaseGoal = value as PurchaseGoal; }
      else if (type === "name") { if (nameParts.length < 2) nameParts.push(value); } // أول قيمتين اسم فقط
    }
  }

  const name = cleanName(nameParts.join(" "));
  let valid = true;
  let skip: string | undefined;
  if (!name) { valid = false; skip = "الاسم فاضي"; }
  else if (!/^05\d{8}$/.test(phone)) { valid = false; skip = "رقم غير صالح"; }

  return { row: sheetRowNumber, name, phone, purchaseMethod, purchaseGoal, district, valid, skip };
}

/** يحلّل قيم الشيت بالتصنيف المحتوائي (كل خلية) — للشيتات المتبعثرة والمنظّمة معًا. */
export function parseRowsByContent(
  values: string[][],
  opts?: { startDataIndex?: number; limit?: number },
): { header: string[]; leads: ParsedLead[]; totalDataRows: number } {
  const header = values[0] ?? [];
  const data = values.slice(1);
  const start = opts?.startDataIndex ?? 0;
  const slice = opts?.limit != null ? data.slice(start, start + opts.limit) : data.slice(start);
  const leads = slice.map((row, i) => classifyRow(row, start + i + 2));
  return { header, leads, totalDataRows: data.length };
}

/**
 * يحلّل قيم الشيت (بما فيها صف العنوان) — يتعرّف على الأعمدة بالمحتوى من عيّنة،
 * ثم يحلّل الصفوف من مؤشّر بيانات محدّد وبحدّ اختياري.
 */
export function parseRows(
  values: string[][],
  opts?: { startDataIndex?: number; limit?: number },
): { header: string[]; cols: DetectedColumns; leads: ParsedLead[]; totalDataRows: number } {
  const header = values[0] ?? [];
  const data = values.slice(1);
  // عيّنة تعرّف ثابتة (أول ٣٠ صف) — لا تتغيّر بين الدفعات.
  const { cols } = detectColumns(header, data.slice(0, 30));
  const start = opts?.startDataIndex ?? 0;
  const slice = opts?.limit != null ? data.slice(start, start + opts.limit) : data.slice(start);
  const leads = slice.map((row, i) => parseRow(row, cols, start + i + 2)); // +2: صف العنوان + فهرسة 1
  return { header, cols, leads, totalDataRows: data.length };
}
