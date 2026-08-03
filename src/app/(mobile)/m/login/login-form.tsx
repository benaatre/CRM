"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Role } from "@prisma/client";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { mobileLoginWithPin, type MobileLoginState } from "./actions";

export type MobileLoginUser = { id: string; name: string; role: Role };

type Tab = "employee" | "manager";

const fieldClass =
  "w-full rounded-xl border px-4 py-3 text-base outline-none transition-colors focus:border-[#CBA45E] disabled:opacity-50";
const fieldStyle = {
  backgroundColor: MOBILE_COLORS.bg,
  borderColor: MOBILE_COLORS.border,
  color: MOBILE_COLORS.textPrimary,
} as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      // ٥٢ بكسل بعرض كامل — زر الدخول الذهبي.
      className="w-full rounded-xl text-base font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
      style={{ height: 52, backgroundColor: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg }}
    >
      {pending ? "جارٍ الدخول…" : "دخول"}
    </button>
  );
}

export function MobileLoginForm({
  employees,
  managers,
}: {
  employees: MobileLoginUser[];
  managers: MobileLoginUser[];
}) {
  const [tab, setTab] = useState<Tab>("employee");
  const [state, formAction] = useActionState<MobileLoginState, FormData>(
    mobileLoginWithPin,
    undefined,
  );

  const list = tab === "employee" ? employees : managers;
  const noUsers = list.length === 0;

  return (
    <div>
      {/* تبويبان: دخول موظف / دخول المدير */}
      <div
        className="mb-6 grid grid-cols-2 gap-1 rounded-xl p-1"
        style={{ backgroundColor: MOBILE_COLORS.card }}
      >
        {(
          [
            ["employee", "دخول موظف"],
            ["manager", "دخول المدير"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={
              tab === value
                ? { backgroundColor: MOBILE_COLORS.sheet, color: MOBILE_COLORS.gold }
                : { color: MOBILE_COLORS.textSecondary }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* مفتاح يجبر React على إعادة بناء الفورم عند تبديل التبويب (يصفّر الحقول) */}
      <form action={formAction} key={tab} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="userId" className="block text-sm" style={{ color: MOBILE_COLORS.textSecondary }}>
            {tab === "employee" ? "الموظف" : "المدير"}
          </label>
          <select
            id="userId"
            name="userId"
            required
            defaultValue=""
            disabled={noUsers}
            className={fieldClass}
            style={fieldStyle}
          >
            <option value="" disabled>
              {noUsers ? "ما فيه حسابات بعد" : "اختر اسمك"}
            </option>
            {list.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="pin" className="block text-sm" style={{ color: MOBILE_COLORS.textSecondary }}>
            الرمز أو كلمة المرور
          </label>
          {/* حقل واحد للتبويبين: الموظف يكتب PIN (٤–٦ أرقام)، المدير كلمة المرور. */}
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            required
            minLength={4}
            placeholder="الرمز أو كلمة المرور"
            disabled={noUsers}
            className={`${fieldClass} text-center`}
            style={fieldStyle}
          />
        </div>

        {state?.error ? (
          <p
            className="rounded-lg px-3 py-2 text-center text-sm"
            style={{ backgroundColor: "#2A0E0E", color: "#F7C1C1" }}
          >
            {state.error}
          </p>
        ) : null}

        <SubmitButton />
      </form>
    </div>
  );
}
