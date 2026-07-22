import { signOut } from "@/auth";

export const runtime = "nodejs";

// نقطة إبطال الجلسة: تمسح كوكي المصادقة ثم تحوّل لصفحة الدخول.
// مستثناة من middleware (المطابق يستثني /api) — فلا حلقة تحويل.
// يُستخدم عند اكتشاف جلسة مُبطَلة (خروج من كل الأجهزة أو حساب موقوف).
export async function GET() {
  await signOut({ redirectTo: "/login" });
}
