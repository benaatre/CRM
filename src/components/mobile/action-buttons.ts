import { SOP } from "@/lib/mobile-tokens";

/**
 * أزرار الفعل الموحّدة في كروت الجوال (/m) — المواصفة المعتمدة followups-fixed2،
 * وتُستخدم حرفيًا في كروت المتابعات والعملاء والموعد القادم (توحيد بصري واحد):
 *   الحاوية: flex · gap 8 · كل زر بلا حد · radius 12 · 600/12.5 · ارتفاع ٤٦ · gap 7 ·
 *   محاذاة وسط · الأيقونة ١٧px بسماكة ٢ (تحت سقف ٢٨px في mobile.css) · الضغط .m-press-sc.
 *   gold: «اتصال» الأساسي الأعرض (flex 1.3) — تدرّج ذهبي، نص/أيقونة --sop-ongold.
 *   wa:   «واتساب» — مزيج أخضر ١٦٪ فوق السطح، نص/أيقونة --sop-green.
 *   file: «الملف» — سطح بارز نيومورفيزمي بحد ذهبي رفيع، نص/أيقونة --sop-gold2.
 * القيم var(--sop-*) نصية — تتبع الوضع (ليل/نهار) تلقائيًا.
 */

/** ارتفاع زر الفعل. */
export const BTN_H = 46;

/** خصائص أيقونة زر الفعل (lucide). */
export const BTN_ICON = { size: 17, strokeWidth: 2 } as const;

export type ActionTone = "gold" | "wa" | "file";

export function actionBtn(tone: ActionTone): React.CSSProperties {
  return {
    boxSizing: "border-box", height: BTN_H, borderRadius: 12, fontSize: 12.5, fontWeight: 600, gap: 7, border: "none",
    ...(tone === "gold"
      ? { background: `linear-gradient(135deg, ${SOP.gold2}, ${SOP.gold})`, color: SOP.onGold }
      : tone === "wa"
        ? { background: `color-mix(in srgb, ${SOP.green} 16%, ${SOP.plane})`, color: SOP.green }
        : {
            background: SOP.plane, color: SOP.gold2,
            boxShadow: `3px 3px 7px ${SOP.sd}, -3px -3px 7px ${SOP.sl}`,
            border: `1px solid color-mix(in srgb, ${SOP.gold} 18%, transparent)`,
          }),
  };
}

/** صنف زر الفعل (التمركز + ردّ فعل اللمس) — يُضاف إليه flex حسب الموضع. */
export const ACTION_BTN_CLASS = "m-press-sc flex items-center justify-center";
