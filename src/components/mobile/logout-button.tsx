"use client";

import { useTransition } from "react";
import { signOutMobileAction } from "@/lib/actions/auth";
import { MOBILE_STATUS } from "@/lib/mobile-tokens";

/**
 * زر «تسجيل الخروج» في /m/more — نفس نمط «الخروج من كل الأجهزة» في
 * security-panel: أكشن خادم لا <a href="/api/logout">، لأن التنقّل الكامل
 * الوحيد في التطبيق كان يُرمى لسفاري خارجي على iOS.
 */
export function MobileLogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await signOutMobileAction(); // يعيد التوجيه بنفسه — إلى /m/login
        })
      }
      className="flex w-full items-center justify-center"
      style={{
        boxSizing: "border-box", minHeight: 52, borderRadius: 16,
        border: `1px solid ${MOBILE_STATUS.danger.border}`, background: MOBILE_STATUS.danger.bg,
        color: MOBILE_STATUS.danger.base, fontSize: "14.5px", fontWeight: 700, marginTop: 4,
        opacity: pending ? 0.6 : 1,
      }}
    >
      تسجيل الخروج
    </button>
  );
}
