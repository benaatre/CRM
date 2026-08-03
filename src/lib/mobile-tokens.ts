/**
 * رموز ألوان تطبيق الجوال (/m) — مصدر واحد لقشرة التطبيق.
 *
 * ⚠️ حدود الاستخدام: هذي الرموز للقشرة (خلفيات/حدود/نصوص/حالات) فقط.
 * ألوان **المراحل والنتائج** لها مصدر حقيقة واحد لا يُنافَس هو
 * `@/lib/stage-colors` (STAGE_TONES / STAGE_HEX) — لا تكرّر لون مرحلة هنا.
 */

/** ألوان السطح والنص — ثيم أوبسيديان. القيم مطابقة لمتغيّرات نموذج التصميم. */
export const MOBILE_COLORS = {
  bg: "#0A0A0B",
  card: "#141416",
  sheet: "#16161A",
  border: "#26262A",
  gold: "#CBA45E",
  textPrimary: "#FFFFFF",
  textSecondary: "#A1A1A6",
  textMuted: "#6E6E73",
  // ===== أسطح إضافية (--page/--panel/--line2/--line3) =====
  page: "#08080A",
  panel: "#0d0d0f",
  line2: "#1c1c20",
  line3: "#1e1e22",
  // ===== نص باهت (--dim1/--dim2) =====
  dim1: "#48484C",
  dim2: "#3a3a3e",
  // ===== الذهبي الموسّع (--gold-lt/--gold-bg/--gold-bd) =====
  goldLight: "#E2C078",
  goldBg: "#1c1710",
  goldBorder: "#3a2f18",
  /** خلفية الشريط السفلي — شفافة، تتطلب backdrop-filter (--tabbar). */
  tabbar: "rgba(14,14,16,.92)",
} as const;

/** رباعية كل حالة: لون أساسي + خلفية غامقة + نص فاتح + حد. */
export type StatusTone = { base: string; bg: string; fg: string; border: string };

export const MOBILE_STATUS: Record<"danger" | "success" | "warning" | "info", StatusTone> = {
  danger: { base: "#E24B4A", bg: "#2A0E0E", fg: "#F7C1C1", border: "#5c2220" },
  success: { base: "#639922", bg: "#173404", fg: "#C0DD97", border: "#2f5c0d" },
  warning: { base: "#C98A16", bg: "#412402", fg: "#FAC775", border: "#6b4008" },
  // النموذج ما عرّف --info-bd — نستعمل الأساسي بشفافية عند الحاجة.
  info: { base: "#378ADD", bg: "#042C53", fg: "#B5D4F4", border: "#0d3f6e" },
};

/** حدّ أدنى لهدف اللمس (إرشادات iOS/Android) — يُستخدم في الشريط السفلي والأزرار. */
export const TOUCH_TARGET_PX = 44;
