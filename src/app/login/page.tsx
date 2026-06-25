import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/data/settings";
import { Brand } from "@/components/layout/brand";
import { LoginForm, type LoginUser } from "./login-form";

// صفحة الدخول — تجيب المستخدمين المفعّلين (id + الاسم + الدور فقط، بدون الرمز).
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  let employees: LoginUser[] = [];
  let managers: LoginUser[] = [];
  let companyName = "مشاريع السلطان";
  let logoUrl: string | null = null;
  let falLicense: string | null = null;

  try {
    const [users, settings] = await Promise.all([
      prisma.user.findMany({
        where: { active: true, pinHash: { not: null } },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      getSettings(),
    ]);
    employees = users.filter((u) => u.role === Role.EMPLOYEE);
    managers = users.filter(
      (u) => u.role === Role.OWNER || u.role === Role.ADMIN,
    );
    companyName = settings.companyName;
    logoUrl = settings.logoUrl;
    falLicense = settings.falLicense;
  } catch {
    // قاعدة البيانات غير مهيّأة بعد — الفورم يعرض رسالة مناسبة.
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          {logoUrl ? (
            <div className="flex justify-center">
              <Brand companyName={companyName} logoUrl={logoUrl} imgClassName="h-16 w-auto" />
            </div>
          ) : (
            <h1 className="font-logo text-4xl font-bold text-gold">{companyName}</h1>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            نظام إدارة المبيعات — سجّل دخولك للمتابعة
          </p>
        </div>

        <div className="glass rounded-2xl p-6 shadow-xl">
          <LoginForm employees={employees} managers={managers} />
        </div>

        {falLicense && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            ترخيص فال (REGA): {falLicense}
          </p>
        )}
      </div>
    </main>
  );
}
