"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllRead } from "@/lib/actions/notifications";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";

/** «علّم الكل مقروء» — نفس أكشن الويب القائم. */
export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markAllRead();
          router.refresh();
        })
      }
      className="flex items-center"
      style={{
        boxSizing: "border-box", minHeight: 44, padding: "0 12px",
        borderRadius: 10, border: `1px solid ${MOBILE_COLORS.border}`,
        background: MOBILE_COLORS.card, color: MOBILE_COLORS.gold,
        fontSize: "12.5px", fontWeight: 600, opacity: pending ? 0.6 : 1,
      }}
    >
      {pending ? "جارٍ…" : "علّم الكل مقروء"}
    </button>
  );
}

export default MarkAllReadButton;
