"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Role } from "@prisma/client";
import { loginWithPin, type LoginState } from "./actions";

export type LoginUser = { id: string; name: string; role: Role };

type Tab = "employee" | "manager";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "جارٍ الدخول…" : "دخول"}
    </button>
  );
}

export function LoginForm({
  employees,
  managers,
}: {
  employees: LoginUser[];
  managers: LoginUser[];
}) {
  const [tab, setTab] = useState<Tab>("employee");
  const [state, formAction] = useActionState<LoginState, FormData>(
    loginWithPin,
    undefined,
  );

  const list = tab === "employee" ? employees : managers;
  const noUsers = list.length === 0;

  return (
    <div>
      {/* تبويبان: دخول موظف / دخول المدير */}
      <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
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
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === value
                ? "bg-card text-gold shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* مفتاح يجبر React على إعادة بناء الفورم عند تبديل التبويب (يصفّر الحقول) */}
      <form action={formAction} key={tab} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="userId" className="block text-sm text-muted-foreground">
            {tab === "employee" ? "الموظف" : "المدير"}
          </label>
          <select
            id="userId"
            name="userId"
            required
            defaultValue=""
            disabled={noUsers}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground outline-none focus:border-gold focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
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
          <label htmlFor="pin" className="block text-sm text-muted-foreground">
            الرمز (PIN)
          </label>
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            minLength={4}
            maxLength={6}
            pattern="\d{4,6}"
            placeholder="••••"
            disabled={noUsers}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-2xl tracking-[0.5em] text-foreground outline-none focus:border-gold focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
          />
        </div>

        {state?.error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {state.error}
          </p>
        ) : null}

        {noUsers ? (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-center text-xs text-warning">
            شغّل البذرة أول: <code dir="ltr">npm run db:seed</code>
          </p>
        ) : null}

        <SubmitButton />
      </form>
    </div>
  );
}
