"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type LoginState = { error?: string } | undefined;

// أكشن الدخول — يقبل رمز PIN رقمي (موظف) أو كلمة مرور نصية (مالك/مدير).
// نفس القيمة تُمرَّر للـauthorize اللي يجرّب passwordHash ثم pinHash.
export async function loginWithPin(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const userId = String(formData.get("userId") ?? "");
  const pin = String(formData.get("pin") ?? "");

  if (!userId) return { error: "اختر اسمك أول" };
  // يقبل: PIN من ٤–٦ أرقام، أو كلمة مرور طولها ٨ فأكثر.
  const isPin = /^\d{4,6}$/.test(pin);
  const isPassword = pin.length >= 8;
  if (!isPin && !isPassword) return { error: "اكتب رمز PIN (٤–٦ أرقام) أو كلمة المرور" };

  try {
    await signIn("pin", {
      userId,
      pin,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    // signIn يرمي إعادة توجيه عند النجاح — لازم نمرّرها.
    if (error instanceof AuthError) {
      return { error: "الرمز غلط أو الحساب غير مفعّل" };
    }
    throw error;
  }
  return undefined;
}
