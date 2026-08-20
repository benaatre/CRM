import Image from "next/image";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/data/settings";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { MobileLoginForm, type MobileLoginUser } from "./login-form";

// نفس مصدر بيانات دخول الويب: المستخدمون المفعّلون (id + الاسم + الدور، بلا الرمز).
export const dynamic = "force-dynamic";

export default async function MobileLoginPage() {
  let employees: MobileLoginUser[] = [];
  let managers: MobileLoginUser[] = [];
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
    employees = users.filter((u) => ([Role.EMPLOYEE, Role.HR, Role.FINANCE] as Role[]).includes(u.role));
    managers = users.filter((u) => u.role === Role.OWNER || u.role === Role.ADMIN);
    falLicense = settings.falLicense;
  } catch {
    // قاعدة البيانات غير مهيّأة بعد — الفورم يعرض «ما فيه حسابات بعد».
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image
            src="/icons/icon-192.png"
            alt="مشاريع السلطان"
            width={88}
            height={88}
            priority
            className="rounded-2xl"
            style={{ filter: "drop-shadow(0 10px 30px rgba(203,164,94,.22))" }}
          />
          <p className="mt-4 text-sm" style={{ color: MOBILE_COLORS.textMuted }}>
            إدارة العملاء والمبيعات
          </p>
        </div>

        <div
          className="rounded-2xl border p-5"
          style={{ backgroundColor: MOBILE_COLORS.card, borderColor: MOBILE_COLORS.border }}
        >
          <MobileLoginForm employees={employees} managers={managers} />
        </div>

        {/* رقم ترخيص فال (REGA) — يظهر في الشاشات العامة. */}
        <p className="mt-8 text-center text-xs" style={{ color: MOBILE_COLORS.textMuted }}>
          ترخيص فال (REGA):{" "}
          <span dir="ltr">{falLicense ?? "1200021029"}</span>
        </p>
      </div>
    </main>
  );
}
