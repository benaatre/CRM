"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type MobileLoginState = { error?: string } | undefined;

/**
 * دخول تطبيق الجوال — **نفس** مزوّد Auth.js المستخدم في الويب (`signIn("pin")`)
 * بلا أي مسار مصادقة جديد. الفرق الوحيد عن أكشن الويب: الوجهة بعد النجاح /m
 * بدل /dashboard (أكشن الويب يثبّتها على /dashboard ولا نلمسه).
 * التحقق من الرمز/كلمة المرور يبقى كله في authorize داخل auth.ts.
 */
export async function mobileLoginWithPin(
  _prev: MobileLoginState,
  formData: FormData,
): Promise<MobileLoginState> {
  const userId = String(formData.get("userId") ?? "");
  const pin = String(formData.get("pin") ?? "");

  if (!userId) return { error: "اختر اسمك أول" };
  // يقبل: PIN من ٤–٦ أرقام، أو كلمة مرور طولها ٨ فأكثر (نفس قاعدة الويب).
  const isPin = /^\d{4,6}$/.test(pin);
  const isPassword = pin.length >= 8;
  if (!isPin && !isPassword) return { error: "اكتب رمز PIN (٤–٦ أرقام) أو كلمة المرور" };

  try {
    await signIn("pin", { userId, pin, redirectTo: "/m" });
  } catch (error) {
    // signIn يرمي إعادة توجيه عند النجاح — لازم نمرّرها.
    if (error instanceof AuthError) {
      return { error: "الرمز غلط أو الحساب غير مفعّل" };
    }
    throw error;
  }
  return undefined;
}
