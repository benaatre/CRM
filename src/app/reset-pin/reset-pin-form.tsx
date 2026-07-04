"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPinByToken } from "@/lib/actions/reset-pin";

export function ResetPinForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pin !== confirm) { setError("الرمزان غير متطابقين"); return; }
    if (!/^\d{6}$/.test(pin)) { setError("الرمز لازم ٦ أرقام"); return; }
    startTransition(async () => {
      const res = await setPinByToken(token, pin);
      if (res.ok) { setDone(true); setTimeout(() => router.push("/login"), 2000); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  if (done) {
    return (
      <p className="rounded-xl bg-success/10 px-4 py-6 text-center text-success">
        تم تعيين رمز الدخول ✅ — جارٍ تحويلك لصفحة الدخول…
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm text-muted-foreground">رمز الدخول الجديد (٤–٦ أرقام)</span>
        <input
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric" dir="ltr" maxLength={6} required placeholder="••••"
          className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-2xl tracking-[0.5em] text-foreground outline-none focus:border-gold"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm text-muted-foreground">تأكيد الرمز</span>
        <input
          value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric" dir="ltr" maxLength={6} required placeholder="••••"
          className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-2xl tracking-[0.5em] text-foreground outline-none focus:border-gold"
        />
      </label>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>}
      <button type="submit" disabled={pending} className="min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? "جارٍ…" : "تعيين الرمز"}
      </button>
    </form>
  );
}
