import { cache } from "react";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { WEB_LOGIN, MOBILE_LOGIN } from "@/lib/logout-target";

/**
 * يحلّ المستخدم الحالي مرّة واحدة لكل طلب (cache) ويفرض إبطال الجلسات:
 * - مستخدم محذوف أو موقوف (active=false) → الجلسة غير صالحة.
 * - «الخروج من كل الأجهزة»: التوكن أُصدر قبل sessionsValidFrom → غير صالح.
 * يرجّع: null (غير مسجّل) | { invalid } (يجب مسح الكوكي) | { user }.
 */
const resolveSession = cache(async () => {
  const session = await auth();
  if (!session?.user) return null;

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { active: true, sessionsValidFrom: true },
  });
  if (!dbUser || !dbUser.active) return { invalid: true } as const;

  const loginAt = session.user.loginAt;
  if (
    dbUser.sessionsValidFrom &&
    (loginAt === undefined || loginAt < dbUser.sessionsValidFrom.getTime())
  ) {
    return { invalid: true } as const;
  }

  return { user: session.user } as const;
});

/** يرجّع المستخدم الحالي أو يحوّل لصفحة الدخول. استخدمه في كل صفحة/أكشن محمي. */
export async function requireUser() {
  const r = await resolveSession();
  if (!r) redirect(WEB_LOGIN);
  // جلسة مُبطَلة (خروج من كل الأجهزة / موقوف) → مسار يمسح الكوكي ثم يحوّل للدخول
  if ("invalid" in r) redirect("/api/logout");
  return r.user;
}

/**
 * نظير requireUser لشاشات التطبيق (/m): نفس ضمانات الإبطال حرفيًا، لكن كل
 * تحويلاته تنتهي داخل التطبيق لا على تخطيط الويب.
 *
 * يُستدعى في قشرة /m — وهي الأب الذي يُحسم قبل عرض أي صفحة تحته، فتحويله
 * يسبق أي requireUser في الصفحات.
 */
export async function requireMobileUser() {
  const r = await resolveSession();
  if (!r) redirect(MOBILE_LOGIN);
  // ?to= صريح: لا نتكل على المُحيل الذي قد يغيب في الإقلاع البارد للتطبيق.
  if ("invalid" in r) redirect(`/api/logout?to=${MOBILE_LOGIN}`);
  return r.user;
}

/** يتطلب دورًا معيّنًا — يحوّل غير المصرّح لهم للوحة. الصلاحية تُطبّق على الخادم. */
export async function requireRole(...roles: Role[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    redirect("/dashboard");
  }
  return user;
}

/** يتطلب صلاحية مدير (مالك أو أدمن). */
export async function requireManager() {
  return requireRole(Role.OWNER, Role.ADMIN);
}

/**
 * صلاحية مدير لاستخدامها داخل server actions — ترمي خطأً نظيفًا (بالعربي) بدل
 * التحويل، فيلتقطه try/catch في الأكشن ويرجّع { ok:false, error } للواجهة.
 * تمنع EMPLOYEE من أي تعديل/إضافة/حذف على الخادم (لا يكفي إخفاء الأزرار).
 */
export async function requireManagerAction() {
  const user = await requireUser();
  if (!isManager(user.role)) {
    throw new Error("هذا الإجراء متاح للمالك أو المدير فقط");
  }
  return user;
}

export function isManager(role: Role) {
  return role === Role.OWNER || role === Role.ADMIN;
}

/* ═════════ الأدوار الجديدة (HR + FINANCE — قرار 2026-08-20) ═════════ */

/** من يستقبل عملاء ويُحسب في نطاقات البيع (توزيع/ليدربورد/إحصاءات) — FINANCE مستحيل بنيويًا. */
export const SELLER_ROLES: Role[] = [Role.EMPLOYEE, Role.HR];
/** من يشاهد حوكمة الدوام وملفات الموظفين (الكتابة تبقى OWNER حصريًا). */
export const GOVERNANCE_VIEWERS: Role[] = [Role.OWNER, Role.HR, Role.FINANCE];
/** من يعتمد/يرفض/يعدّل طلبات الإجازة — قرار نهائي، وغير المالك يُشعر المالك فورًا. */
export const LEAVE_DECIDERS: Role[] = [Role.OWNER, Role.HR, Role.FINANCE];
/** من يُرصد دوامه في اللوحات والكرون (المالك مراقب لا مرصود). */
export const TRACKED_ROLES: Role[] = [Role.EMPLOYEE, Role.ADMIN, Role.HR, Role.FINANCE];

export const isHR = (role: Role) => role === Role.HR;
export const isFinance = (role: Role) => role === Role.FINANCE;
export const isSeller = (role: Role) => SELLER_ROLES.includes(role);
export const canViewGovernance = (role: Role) => GOVERNANCE_VIEWERS.includes(role);
export const canDecideLeaves = (role: Role) => LEAVE_DECIDERS.includes(role);

/**
 * حارس شاشات العملاء: FINANCE «بلا عملاء نهائيًا» — يُصدّ خادميًا ويُحوَّل لخط
 * المبيعات (وجهته الطبيعية). البقية يمرّون كما كانوا حرفيًا.
 */
export async function requireClientAccess(mobile = false) {
  const user = await requireUser();
  if (user.role === Role.FINANCE) redirect(mobile ? "/m/bookings" : "/bookings");
  return user;
}
