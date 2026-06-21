import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { auth } from "@/auth";

/** يرجّع المستخدم الحالي أو يحوّل لصفحة الدخول. استخدمه في كل صفحة/أكشن محمي. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session.user;
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

export function isManager(role: Role) {
  return role === Role.OWNER || role === Role.ADMIN;
}
