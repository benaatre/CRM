"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { AppSettings } from "@/lib/data/settings";
import { updateSettings, updateMyPin, syncGoogleSheet } from "@/lib/actions/settings";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(settings.autoAssign);

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
    <div className="space-y-6">
      <form onSubmit={submit} className="glass max-w-xl space-y-4 rounded-2xl p-6">
        <h2 className="font-semibold text-foreground">بيانات الشركة</h2>
        <Field label="اسم الشركة *">
          <input name="companyName" required defaultValue={settings.companyName} className="select-base" />
        </Field>
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

        <Field label="رابط جوجل شيت (مزامنة تلقائية)">
          <input name="googleSheetUrl" defaultValue={settings.googleSheetUrl ?? ""} dir="ltr" className="select-base" placeholder="https://docs.google.com/spreadsheets/d/..." />
        </Field>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}

        <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {pending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
        </button>
      </form>

      <SheetSync configured={!!settings.googleSheetUrl} lastSyncAt={settings.lastSyncAt} />
      <PinForm />
    </div>
  );
}

function SheetSync({ configured, lastSyncAt }: { configured: boolean; lastSyncAt: Date | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function sync() {
    setMsg(null);
    startTransition(async () => {
      const res = await syncGoogleSheet();
      setMsg(res.ok ? `تمت المزامنة — ${res.created ?? 0} عميل جديد` : res.error ?? "صار خطأ");
      router.refresh();
    });
  }

  return (
    <div className="glass max-w-xl space-y-3 rounded-2xl p-6">
      <h2 className="font-semibold text-foreground">مزامنة جوجل شيت</h2>
      <p className="text-xs text-muted-foreground">
        يسحب الليدات الجديدة من الشيت ويتجاهل المكرر (نفس الجوال). للمزامنة الدورية التلقائية على الخادم، اضبط cron يستدعي{" "}
        <code dir="ltr">/api/sync-sheet?secret=…</code>
      </p>
      {lastSyncAt && <p className="text-xs text-muted-foreground">آخر مزامنة: {timeAgo(lastSyncAt)}</p>}
      <button onClick={sync} disabled={pending || !configured} className="flex items-center gap-2 rounded-xl border border-gold/40 px-5 py-2.5 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-50">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {configured ? "مزامنة الآن" : "أضف رابط الشيت أول"}
      </button>
    </div>
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
      if (res.ok) { setMsg("تم تغيير الرمز ✅"); (e.target as HTMLFormElement).reset(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <form onSubmit={submit} className="glass max-w-xl space-y-4 rounded-2xl p-6">
      <h2 className="font-semibold text-foreground">رمز الدخول (PIN)</h2>
      <Field label="رمز جديد (٤–٦ أرقام)">
        <input name="pin" inputMode="numeric" dir="ltr" maxLength={6} className="select-base" placeholder="••••" />
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
