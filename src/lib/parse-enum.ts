/**
 * يقرأ قيمة enum بأمان من مدخل غير موثوق (FormData): يرجّعها لو ضمن القيم المسموحة،
 * وإلا يرجّع fallback (أو null). يمنع تمرير قيم خاطئة لـPrisma.
 */
export function parseEnum<T extends Record<string, string>>(
  enumObj: T,
  raw: unknown,
  fallback?: T[keyof T],
): T[keyof T] | null {
  const v = String(raw ?? "").trim();
  if (v && v in enumObj) return v as T[keyof T];
  return fallback ?? null;
}
