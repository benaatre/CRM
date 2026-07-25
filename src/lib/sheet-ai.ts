import "server-only";

// طبقة الـAI للصفوف العصية (fallback لا أساس): المصنّف بالقواعد يعالج الأغلبية مجانًا،
// والصفوف التي تعجز عنها القواعد تُجمع وتُرسل **دفعة واحدة** إلى Claude API —
// نفس نمط مساعد الـAI القائم (fetch خام + ANTHROPIC_API_KEY من .env، لا يصل المتصفح).
// فشل الدفعة كله آمن: null → كل صف يدخل بما التقطته القواعد + «يحتاج مراجعة». لا يضيع صف أبدًا.
import type { PurchaseGoal, PurchaseMethod } from "@prisma/client";
import { normalizePhone, normalizePurchaseGoal, normalizePurchaseMethod } from "@/lib/value-normalize";
import { normalizeAreas, type AreasParse } from "@/lib/utils/sheet-parse";

/** نتيجة الـAI لصف واحد بعد التحقق والتطبيع على قيم النظام. */
export type AiRowResult = {
  name: string | null;
  phone: string | null;              // موحّد 05XXXXXXXX — أو null لو غير معقول
  purchaseGoal: PurchaseGoal | null;
  purchaseMethod: PurchaseMethod | null;
  areas: string[];                   // مطبّعة بقاموس الأحياء القائم
  areaNote: string | null;
  priceMin: number | null;
  priceMax: number | null;
};

const PROMPT_HEADER =
  "استخرج من كل صف من الصفوف التالية: الاسم الكامل، رقم الجوال السعودي، هدف الشراء " +
  "(سكن أو استثمار أو سكن واستثمار)، طريقة الشراء (كاش أو تمويل مدعوم أو تمويل غير مدعوم أو كاش وتمويل)، " +
  "الحي (الرياض ظهرة لبن أو الرياض المهدية أو الرياض الأحمدية أو الثلاثة أو أخرى)، " +
  "السعر من وإلى بالريال السعودي كأرقام. " +
  "أرجع JSON فقط: مصفوفة بنفس ترتيب الصفوف وبنفس عددها، كل عنصر بهذا الشكل " +
  '{"name":..,"phone":..,"goal":..,"method":..,"district":..,"priceMin":..,"priceMax":..} ' +
  "والحقل غير الموجود null. لا تشرح ولا تضف أي نص خارج الـJSON.";

type RawAiRow = {
  name?: unknown; phone?: unknown; goal?: unknown; method?: unknown;
  district?: unknown; priceMin?: unknown; priceMax?: unknown;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/**
 * يحلّل الصفوف العصية دفعة واحدة (طلب واحد — لا طلب لكل صف). يرجّع null عند أي فشل
 * (مفتاح مفقود، خطأ شبكة، JSON غير صالح، عدد لا يطابق) — والمستدعي يطبّق مسار «يحتاج مراجعة».
 */
export async function analyzeStubbornRows(rows: string[][]): Promise<AiRowResult[] | null> {
  if (rows.length === 0) return [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const body = rows
    .map((cells, i) => `صف ${i + 1}: ${cells.filter((c) => String(c ?? "").trim()).join(" | ")}`)
    .join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // نفس نمط مساعد الـAI القائم في النظام (route handler) — الموديل من البيئة بنفس الافتراضي.
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: `${PROMPT_HEADER}\n\n${body}` }],
      }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    let text: string = data?.content?.[0]?.text ?? "";
    // تحصين خفيف: إزالة أسوار الكود لو أُضيفت رغم التعليمات.
    text = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    const parsed: unknown = JSON.parse(text);
    // التحقق: JSON صالح + مصفوفة بنفس العدد — وإلا فشل الدفعة كلها (آمن).
    if (!Array.isArray(parsed) || parsed.length !== rows.length) return null;

    return (parsed as RawAiRow[]).map((r) => {
      // جوال معقول فقط: يطبّع عبر normalizePhone الموحّد ويُقبل حصريًا بصيغة 05XXXXXXXX.
      const phoneNorm = normalizePhone(str(r.phone) ?? "");
      const phone = /^05\d{8}$/.test(phoneNorm) ? phoneNorm : null;
      const district = str(r.district);
      const areasParse: AreasParse = district && district !== "أخرى"
        ? normalizeAreas(district)
        : { areas: district === "أخرى" ? ["أخرى"] : [], note: null };
      let priceMin = num(r.priceMin);
      let priceMax = num(r.priceMax);
      if (priceMin != null && priceMax != null && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
      return {
        name: str(r.name),
        phone,
        purchaseGoal: normalizePurchaseGoal(str(r.goal)),
        purchaseMethod: normalizePurchaseMethod(str(r.method)),
        areas: areasParse.areas,
        areaNote: areasParse.note,
        priceMin,
        priceMax,
      };
    });
  } catch {
    return null; // أي فشل = دفعة فاشلة بأمان — المستدعي يدخل الصفوف بمسار «يحتاج مراجعة»
  }
}
