"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AppSettings } from "@/lib/data/settings";
import { updateSettings } from "@/lib/actions/settings";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateSettings(fd);
      if (res.ok) { setMsg("تم الحفظ ✅"); router.refresh(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <form onSubmit={submit} className="glass max-w-xl space-y-4 rounded-2xl p-6">
      <Field label="اسم الشركة *">
        <input name="companyName" required defaultValue={settings.companyName} className="select-base" />
      </Field>
      <Field label="رقم ترخيص فال (REGA)">
        <input name="falLicense" defaultValue={settings.falLicense ?? ""} dir="ltr" className="select-base" placeholder="مثال: 1200000000" />
      </Field>
      <Field label="جوال الشركة">
        <input name="phone" defaultValue={settings.phone ?? ""} dir="ltr" className="select-base" placeholder="05xxxxxxxx" />
      </Field>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}

      <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
