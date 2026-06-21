"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type LoginState = { error?: string } | undefined;

// أكشن الدخول برمز PIN — يُستدعى من فورم الدخول.
export async function loginWithPin(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const userId = String(formData.get("userId") ?? "");
  const pin = String(formData.get("pin") ?? "");

  if (!userId) return { error: "اختر اسمك أول" };
  if (!/^\d{4,6}$/.test(pin)) return { error: "الرمز لازم يكون ٤–٦ أرقام" };

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
