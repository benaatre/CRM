/**
 * رموز ألوان تطبيق الجوال (/m) — مصدر واحد لقشرة التطبيق.
 *
 * ⚠️ حدود الاستخدام: هذي الرموز للقشرة (خلفيات/حدود/نصوص/حالات) فقط.
 * ألوان **المراحل والنتائج** لها مصدر حقيقة واحد لا يُنافَس هو
 * `@/lib/stage-colors` (STAGE_TONES / STAGE_HEX) — لا تكرّر لون مرحلة هنا.
 */

/** ألوان السطح والنص — ثيم أوبسيديان. */
export const MOBILE_COLORS = {
  bg: "#0A0A0B",
  card: "#141416",
  sheet: "#16161A",
  border: "#26262A",
  gold: "#CBA45E",
  textPrimary: "#FFFFFF",
  textSecondary: "#A1A1A6",
  textMuted: "#6E6E73",
} as const;

/** ثلاثية كل حالة: لون أساسي + خلفية غامقة + نص فاتح. */
export type StatusTone = { base: string; bg: string; fg: string };

export const MOBILE_STATUS: Record<"danger" | "success" | "warning" | "info", StatusTone> = {
  danger: { base: "#E24B4A", bg: "#2A0E0E", fg: "#F7C1C1" },
  success: { base: "#639922", bg: "#173404", fg: "#C0DD97" },
  warning: { base: "#C98A16", bg: "#412402", fg: "#FAC775" },
  info: { base: "#378ADD", bg: "#042C53", fg: "#B5D4F4" },
};

/** حدّ أدنى لهدف اللمس (إرشادات iOS/Android) — يُستخدم في الشريط السفلي والأزرار. */
export const TOUCH_TARGET_PX = 44;
