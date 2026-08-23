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
  // ===== توكنز «الديوان» (رئيسية الموظف): حد شعري + شفافيات الذهبي + التدرّج + زجاج التوب بار =====
  hair: "var(--m-hair)",
  accDim: "var(--m-acc-dim)",
  accA20: "var(--m-acc-a20)",
  accA32: "var(--m-acc-a32)",
  accGlow: "var(--m-acc-glow)",
  gradA: "var(--m-grad-a)",
  gradB: "var(--m-grad-b)",
  gradC: "var(--m-grad-c)",
  navBg: "var(--m-nav-bg)",
  /** واتساب الرسمي — قرار هوية معتمد، ثابت في الثيمين. */
  wa: "var(--m-wa)",
  // ===== لوحة الديوان غير الذهبية (المطابقة الحرفية): حرفية من المرجع بثيميه =====
  dwGreen: "var(--m-dw-green)",
  dwGreenD: "var(--m-dw-green-d)",
  dwGreenDim: "var(--m-dw-green-dim)",
  dwGreenA32: "var(--m-dw-green-a32)",
  dwAmber: "var(--m-dw-amber)",
  dwAmberDim: "var(--m-dw-amber-dim)",
  dwSky: "var(--m-dw-sky)",
  dwSkyDim: "var(--m-dw-sky-dim)",
  dwBlue: "var(--m-dw-blue)",
  dwPurple: "var(--m-dw-purple)",
  dwPurpleDim: "var(--m-dw-purple-dim)",
  dwRed: "var(--m-dw-red)",
  dwRedDim: "var(--m-dw-red-dim)",
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

/**
 * ===== SOP — «أوبسيديان ناعم Pro» =====
 * طبقة التوكنز الدلالية الجديدة (mobile.css — كتلتا --sop-* ليل/نهار). نفس عقد
 * MOBILE_COLORS: قيم `var()` نصية تُستخدم داخل style السطري وتتبع الوضع تلقائيًا.
 * ألوان المراحل تبقى من `@/lib/stage-colors` (STAGE_HEX) — لا تُكرَّر هنا.
 */
export const SOP = {
  page: "var(--sop-page)",
  plane: "var(--sop-plane)",
  planeHi: "var(--sop-plane-hi)",
  /** ظل غامق (النيومورفيزم). */
  sd: "var(--sop-sd)",
  /** لمعة فاتحة (النيومورفيزم). */
  sl: "var(--sop-sl)",
  edge: "var(--sop-edge)",
  edge2: "var(--sop-edge-2)",
  tx: "var(--sop-tx)",
  tx2: "var(--sop-tx2)",
  mut: "var(--sop-mut)",
  gold: "var(--sop-gold)",
  gold2: "var(--sop-gold2)",
  /** نص فوق الذهبي الممتلئ. */
  onGold: "var(--sop-ongold)",
  green: "var(--sop-green)",
  red: "var(--sop-red)",
  blue: "var(--sop-blue)",
  amber: "var(--sop-amber)",
  neutral: "var(--sop-neutral)",
  purple: "var(--sop-purple)",
  teal: "var(--sop-teal)",
} as const;

/** ظلال النيومورفيزم الجاهزة للـstyle السطري (نفس قيم .m-raise/.m-inset في mobile.css). */
export const SOP_SHADOW = {
  raise: `6px 6px 16px ${SOP.sd}, -5px -5px 14px ${SOP.sl}`,
  inset: `inset 4px 4px 10px ${SOP.sd}, inset -4px -4px 10px ${SOP.sl}`,
} as const;

/** وضع العرض — يُقرأ من كوكي `m-theme` على الخادم فلا وميض ولا اختلاف ترطيب. */
export type MobileTheme = "dark" | "light";
export const MOBILE_THEME_COOKIE = "m-theme";
export const normalizeTheme = (v: string | undefined): MobileTheme => (v === "light" ? "light" : "dark");
