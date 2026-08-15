/**
 * لغة ألوان شاشات الدوام — قشرتان لمكوّن واحد.
 *
 * بطاقة البصم تُركّب في مكانين بثيمين مختلفين: تطبيق الجوال (/m) الذي يعرّف
 * `--m-*` في `mobile.css`، وشاشات الويب التي تعرّف `--card/--border/--gold…`
 * في `globals.css`. بدل تكرار المكوّن، نبدّل خريطة المتغيّرات فقط — فكل قشرة
 * تتبع ثيمها (ليلي/نهاري) تلقائيًا بلا كود لون واحد مكتوب هنا.
 */

export type AttendanceTheme = "mobile" | "web";

export type AttendancePalette = {
  card: string;
  sheet: string;
  border: string;
  text1: string;
  text2: string;
  text3: string;
  gold: string;
  /** لون النص فوق الذهبي المصمت. */
  onGold: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
};

export const ATTENDANCE_PALETTE: Record<AttendanceTheme, AttendancePalette> = {
  mobile: {
    card: "var(--m-card)",
    sheet: "var(--m-sheet)",
    border: "var(--m-border)",
    text1: "var(--m-text1)",
    text2: "var(--m-text2)",
    text3: "var(--m-text3)",
    gold: "var(--m-gold)",
    onGold: "var(--m-bg)",
    success: "var(--m-success)",
    danger: "var(--m-danger)",
    warning: "var(--m-warning)",
    info: "var(--m-info)",
  },
  web: {
    card: "var(--card)",
    sheet: "var(--secondary)",
    border: "var(--border)",
    text1: "var(--foreground)",
    text2: "var(--muted-foreground)",
    text3: "var(--muted-foreground)",
    gold: "var(--gold)",
    onGold: "var(--primary-foreground)",
    success: "var(--success)",
    danger: "var(--destructive)",
    warning: "var(--warning)",
    info: "var(--info)",
  },
};

/**
 * خلفية باهتة مشتقّة من لون التوكن — `color-mix` تعمل على `var(...)` بخلاف دمج
 * السلاسل النصّية (`${gold}30` لا ينتج لونًا)، فتكفينا عن توكن خلفية لكل حالة
 * في كل قشرة.
 */
export function tint(color: string, percent = 12): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** نبرة الرسالة المعروضة بعد البصم. */
export type FeedbackTone = "success" | "danger" | "warning" | "info";

/* ===== دقائق منتصف الليل ⟷ نصوص — مشتركة بين تبويبات المالك وملف الموظف ===== */

/** دقائق من منتصف الليل ⟵ قيمة <input type="time"> والعكس. */
export function minutesToTime(m: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
}

export function timeToMinutes(v: string): number | null {
  const [h, m] = v.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** «٥٤٠» ⟵ «٩:٠٠ ص» — عرض دقيقة اليوم بصيغة ١٢ ساعة بأرقام عربية. */
export function minuteLabel(m: number, toArabic: (s: string | number) => string): string {
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${toArabic(h12)}:${toArabic(String(mm).padStart(2, "0"))} ${h24 < 12 ? "ص" : "م"}`;
}

/** «٢٧٥ دقيقة» ⟵ «٤:٣٥» بأرقام عربية — لشريط «أنجز ٤:٣٥ من ٨ ساعات». */
export function hmLabel(minutes: number, toArabic: (s: string | number) => string): string {
  const t = Math.max(0, Math.round(minutes));
  return `${toArabic(Math.floor(t / 60))}:${toArabic(String(t % 60).padStart(2, "0"))}`;
}

export function toneColor(p: AttendancePalette, tone: FeedbackTone): string {
  return tone === "success" ? p.success : tone === "danger" ? p.danger : tone === "warning" ? p.warning : p.info;
}
