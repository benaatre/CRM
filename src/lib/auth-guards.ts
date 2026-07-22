import { cache } from "react";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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
  if (!r) redirect("/login");
  // جلسة مُبطَلة (خروج من كل الأجهزة / موقوف) → مسار يمسح الكوكي ثم يحوّل للدخول
  if ("invalid" in r) redirect("/api/logout");
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
