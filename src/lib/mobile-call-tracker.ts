/**
 * تتبّع آخر نقرة «اتصال» — لورقة تسجيل النتيجة عند العودة للمقدمة (Capacitor).
 * sessionStorage عمدًا: يموت بموت الجلسة، ولا يتسرّب بين المستخدمين.
 */
const KEY = "sultan.lastCall";

/** نافذة اعتبار الاتصال «حديثًا» — ٥ دقائق. */
export const CALL_FRESH_MS = 5 * 60_000;

export function markCall(leadId: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ leadId, ts: Date.now() }));
  } catch {
    /* وضع خاص/تخزين ممتلئ — التتبع تحسين لا شرط */
  }
}

/** يقرأ آخر اتصال إن كان خلال النافذة، ويمسحه (يُستهلك مرة واحدة). */
export function takeRecentCall(): { leadId: string; ts: number } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { leadId?: string; ts?: number };
    sessionStorage.removeItem(KEY);
    if (!parsed.leadId || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > CALL_FRESH_MS) return null;
    return { leadId: parsed.leadId, ts: parsed.ts };
  } catch {
    return null;
  }
}
