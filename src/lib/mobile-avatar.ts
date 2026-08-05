/**
 * أفاتار الموظف في تطبيق الجوال — حرفان + لون ثابت مشتق من المعرّف.
 *
 * صياغة عرض بحتة (لا بيانات ولا منطق): نفس المعرّف يعطي نفس اللون دائمًا وفي كل
 * شاشة، فيتعرّف المستخدم على الموظف بلونه قبل ما يقرأ اسمه.
 *
 * الألوان لوحة منفصلة عن `mobile-tokens` (قشرة) و`stage-colors` (مراحل) — هذي
 * هويات أشخاص لا حالات نظام، فما تتبع الثيم ولا تتصادم مع أي دلالة لونية.
 */

/** لوحة ثابتة — درجات مشبعة تُقرأ على الداكن والفاتح معًا. */
const AVATAR_COLORS = [
  "#C2703F", // نحاسي
  "#3E7CA6", // أزرق هادئ
  "#6B7F3A", // زيتوني
  "#8A5A9B", // بنفسجي
  "#A8484A", // طوبي
  "#3F8A7A", // تركوازي
  "#8B6A2B", // كهرماني
  "#5A6E9B", // نيلي
] as const;

/** hash ثابت (djb2 مبسّط) — لا Math.random ولا فهرس مصفوفة يتغيّر مع الترتيب. */
export function avatarColor(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/**
 * حرفان: أول حرف من الاسم الأول + أول حرف من الثاني إن وُجد.
 * الاسم المفرد يعطي حرفًا واحدًا (أفضل من تكرار الحرف نفسه).
 */
export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  if (parts.length === 1) return parts[0].slice(0, 1);
  return parts[0].slice(0, 1) + parts[1].slice(0, 1);
}
