/**
 * رموز ألوان تطبيق الجوال (/m) — مصدر واحد لقشرة التطبيق.
 *
 * ⚠️ حدود الاستخدام: هذي الرموز للقشرة (خلفيات/حدود/نصوص/حالات) فقط.
 * ألوان **المراحل والنتائج** لها مصدر حقيقة واحد لا يُنافَس هو
 * `@/lib/stage-colors` (STAGE_TONES / STAGE_HEX) — لا تكرّر لون مرحلة هنا.
 *
 * ⚠️ القيم متغيّرات CSS لا أكواد hex — تُعرَّف في `app/(mobile)/m/mobile.css`
 * تحت `:root` (ليلي) و`[data-theme="light"]` (نهاري)، والسمة تُوضع على غلاف
 * (mobile). `var(...)` تعمل داخل `style` السطري تمامًا كما في CSS، فكل شاشة
 * تستورد من هنا تتبع الثيم تلقائيًا بلا تعديل.
 *
 * لذلك: لا تقارن هذي القيم ولا تشتقّ منها ألوانًا بسلاسل نصية
 * (`${MOBILE_COLORS.gold}30` لن يعمل) — استعمل متغيّرًا جاهزًا أو أضف واحدًا.
 */

/** ألوان السطح والنص — ثيم أوبسيديان (ليلي) ونظيره النهاري. */
export const MOBILE_COLORS = {
  bg: "var(--m-bg)",
  card: "var(--m-card)",
  sheet: "var(--m-sheet)",
  border: "var(--m-border)",
  gold: "var(--m-gold)",
  textPrimary: "var(--m-text1)",
  textSecondary: "var(--m-text2)",
  textMuted: "var(--m-text3)",
  // ===== أسطح إضافية (--page/--panel/--line2/--line3) =====
  page: "var(--m-page)",
  panel: "var(--m-panel)",
  line2: "var(--m-line2)",
  line3: "var(--m-line3)",
  // ===== نص باهت (--dim1/--dim2) =====
  dim1: "var(--m-dim1)",
  dim2: "var(--m-dim2)",
  // ===== الذهبي الموسّع (--gold-lt/--gold-bg/--gold-bd) =====
  goldLight: "var(--m-gold-lt)",
  goldBg: "var(--m-gold-bg)",
  goldBorder: "var(--m-gold-bd)",
  /** خلفية الشريط السفلي — شفافة، تتطلب backdrop-filter (--tabbar). */
  tabbar: "var(--m-tabbar)",
  // ===== لوحة v2 (رئيسية الموظف) — أربع حالات زاهية بخلفياتها (--m-mint/rose/sky/amber) =====
  mint: "var(--m-mint)",
  mintBg: "var(--m-mint-bg)",
  rose: "var(--m-rose)",
  roseBg: "var(--m-rose-bg)",
  sky: "var(--m-sky)",
  skyBg: "var(--m-sky-bg)",
  amber: "var(--m-amber)",
  amberBg: "var(--m-amber-bg)",
} as const;

/** رباعية كل حالة: لون أساسي + خلفية غامقة + نص فاتح + حد. */
export type StatusTone = { base: string; bg: string; fg: string; border: string };

export const MOBILE_STATUS: Record<"danger" | "success" | "warning" | "info", StatusTone> = {
  danger: { base: "var(--m-danger)", bg: "var(--m-danger-bg)", fg: "var(--m-danger-fg)", border: "var(--m-danger-bd)" },
  success: { base: "var(--m-success)", bg: "var(--m-success-bg)", fg: "var(--m-success-fg)", border: "var(--m-success-bd)" },
  warning: { base: "var(--m-warning)", bg: "var(--m-warning-bg)", fg: "var(--m-warning-fg)", border: "var(--m-warning-bd)" },
  info: { base: "var(--m-info)", bg: "var(--m-info-bg)", fg: "var(--m-info-fg)", border: "var(--m-info-bd)" },
};

/** حدّ أدنى لهدف اللمس (إرشادات iOS/Android) — يُستخدم في الشريط السفلي والأزرار. */
export const TOUCH_TARGET_PX = 44;

/** وضع العرض — يُقرأ من كوكي `m-theme` على الخادم فلا وميض ولا اختلاف ترطيب. */
export type MobileTheme = "dark" | "light";
export const MOBILE_THEME_COOKIE = "m-theme";
export const normalizeTheme = (v: string | undefined): MobileTheme => (v === "light" ? "light" : "dark");
