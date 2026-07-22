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

/** قيمة «حي»: تبدأ بكلمة «حي» أو تطابق اسم حي معروف. */
function isDistrictValue(raw: string | null | undefined): boolean {
  const s = norm(cleanValue(raw ?? ""));
  if (!s) return false;
  if (/(^|\s)حي(\s|$)/.test(s)) return true;
  return KNOWN_DISTRICTS.some((d) => d && s.includes(d));
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

/** قيمة تصلح أن تكون «اسم»: حروف، وليست UUID/تاريخ/رقم/طريقة/هدف. */
function isNameLike(v: string): boolean {
  if (!hasLetters(v)) return false;
  if (UUID_RE.test(v) || DATE_RE.test(v)) return false;
  if (matchPurchaseMethod(v) || normalizePurchaseGoal(v)) return false;
  return true;
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

// ===================== تصنيف كل قيمة بمحتواها (للشيتات المتبعثرة) =====================

export type CellType = "phone" | "method" | "district" | "goal" | "name" | "ignore";

/** يصنّف قيمة خلية واحدة حسب محتواها (بعد التنظيف). */
function classifyCell(raw: string | null | undefined): { type: CellType; value: string } {
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
function classifyRow(cells: string[], sheetRowNumber: number): ParsedLead {
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
