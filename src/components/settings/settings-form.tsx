"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AppSettings } from "@/lib/data/settings";
import { updateSettings, updateMyPin, setOwnerPassword } from "@/lib/actions/settings";
import { NotificationsPanel } from "@/components/settings/notifications-panel";

export function SettingsForm({ settings, isOwner }: { settings: AppSettings; isOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(settings.autoAssign);
  const [logoPreview, setLogoPreview] = useState<string | null>(settings.logoUrl);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateSettings(fd);
      if (res.ok) { setMsg("تم الحفظ"); router.refresh(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="glass max-w-xl space-y-4 rounded-2xl p-6">
        <h2 className="font-semibold text-foreground">هوية الشركة</h2>
        <Field label="اسم الشركة * (يظهر في كل الواجهات)">
          <input name="companyName" required defaultValue={settings.companyName} className="select-base" />
        </Field>

        {/* لوجو الشركة */}
        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">لوجو الشركة (يظهر بالهيدر وصفحة الدخول)</span>
          <div className="flex items-center gap-3">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="لوجو" className="size-full object-contain" />
              ) : (
                <span className="font-logo text-xs text-gold">لا يوجد</span>
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <input
                type="file"
                name="logo"
                accept="image/*"
                onChange={(e) => { const f = e.target.files?.[0]; setLogoPreview(f ? URL.createObjectURL(f) : settings.logoUrl); }}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-foreground"
              />
              <p className="text-[0.7rem] text-muted-foreground">PNG/JPG/SVG — أقل من ٥٠٠ كيلوبايت.</p>
              {settings.logoUrl && (
                <label className="flex items-center gap-2 text-xs text-destructive">
                  <input type="checkbox" name="removeLogo" onChange={(e) => { if (e.target.checked) setLogoPreview(null); }} />
                  إزالة اللوجو الحالي
                </label>
              )}
            </div>
          </div>
        </div>

        <Field label="رقم ترخيص فال (REGA)">
          <input name="falLicense" defaultValue={settings.falLicense ?? ""} dir="ltr" className="select-base" placeholder="مثال: 1200000000" />
        </Field>
        <Field label="جوال الشركة">
          <input name="phone" defaultValue={settings.phone ?? ""} dir="ltr" className="select-base" placeholder="05xxxxxxxx" />
        </Field>

        {/* إسناد تلقائي */}
        <label className="flex items-center justify-between rounded-xl border border-border p-3">
          <div>
            <div className="text-sm font-medium text-foreground">إسناد تلقائي للموظف</div>
            <div className="text-xs text-muted-foreground">العملاء الجدد يُسندون تلقائيًا للموظف الأقل حملًا</div>
          </div>
          <input type="checkbox" name="autoAssign" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="size-5 accent-[var(--gold)]" />
        </label>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}

        <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {pending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
        </button>
      </form>

      <NotificationsPanel notify={settings.notify} />
      <PinForm />
      {isOwner && <OwnerPassword />}
    </div>
  );
}

// كلمة مرور قوية للمالك — بديل/إضافة على PIN. PIN يبقى شغّالًا كطريق رجوع.
function OwnerPassword() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await setOwnerPassword(fd);
      if (res.ok) { setMsg("تم تعيين كلمة المرور"); (e.target as HTMLFormElement).reset(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <form onSubmit={submit} className="glass max-w-xl space-y-4 rounded-2xl p-6">
      <h2 className="font-semibold text-foreground">كلمة مرور المالك</h2>
      <p className="text-xs text-muted-foreground">
        كلمة مرور قوية للدخول (٨ أحرف على الأقل). الـPIN يبقى شغّالًا كطريق رجوع.
      </p>
      <Field label="كلمة المرور الجديدة">
        <input name="password" type="password" autoComplete="new-password" minLength={8} dir="ltr" className="select-base" placeholder="••••••••" />
      </Field>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}
      <button type="submit" disabled={pending} className="rounded-xl border border-gold/40 px-5 py-2.5 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-50">
        {pending ? "جارٍ…" : "تعيين كلمة المرور"}
      </button>
    </form>
  );
}

function PinForm() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateMyPin(fd);
      if (res.ok) { setMsg("تم تغيير الرمز"); (e.target as HTMLFormElement).reset(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <form onSubmit={submit} className="glass max-w-xl space-y-4 rounded-2xl p-6">
      <h2 className="font-semibold text-foreground">رمز الدخول (PIN)</h2>
      <Field label="الرمز الحالي">
        <input name="currentPin" inputMode="numeric" dir="ltr" maxLength={6} className="select-base" placeholder="••••••" />
      </Field>
      <Field label="رمز جديد (٦ أرقام)">
        <input name="pin" inputMode="numeric" dir="ltr" maxLength={6} className="select-base" placeholder="••••••" />
      </Field>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}
      <button type="submit" disabled={pending} className="rounded-xl border border-gold/40 px-5 py-2.5 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-50">
        {pending ? "جارٍ…" : "تغيير الرمز"}
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
