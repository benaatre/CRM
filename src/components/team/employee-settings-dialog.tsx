"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2 } from "lucide-react";
import { fetchEmployeeDetail, fetchProjectsList, updateEmployee, inviteEmployee, type EmployeeDetail } from "@/lib/actions/team";

export function EmployeeSettingsDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function sendInvite() {
    setInviteMsg(null);
    startTransition(async () => {
      const res = await inviteEmployee(userId);
      setInviteMsg({ ok: res.ok, text: res.ok ? (res.message ?? "تم الإرسال") : (res.error ?? "صار خطأ") });
    });
  }

  useEffect(() => {
    Promise.all([fetchEmployeeDetail(userId), fetchProjectsList()]).then(([d, p]) => {
      setDetail(d);
      setProjects(p);
      if (d) { setAllowed(new Set(d.allowedProjectIds)); setActive(d.active); }
    });
  }, [userId]);

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    allowed.forEach((id) => fd.append("allowedProjects", id));
    fd.set("active", active ? "on" : "");
    startTransition(async () => {
      const res = await updateEmployee(userId, fd);
      if (res.ok) { router.refresh(); onClose(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">إعدادات الموظف</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="size-5" /></button>
        </div>

        {!detail ? (
          <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="الاسم"><input name="name" required defaultValue={detail.name} className="select-base" /></Field>
              <Field label="الجوال"><input name="phone" dir="ltr" defaultValue={detail.phone ?? ""} className="select-base" /></Field>
              <Field label="الإيميل (اختياري)"><input name="email" type="email" dir="ltr" defaultValue={detail.email ?? ""} className="select-base" placeholder="name@example.com" /></Field>
              <Field label="الدور">
                <select name="role" defaultValue={detail.role} className="select-base">
                  <option value="EMPLOYEE">موظف مبيعات</option>
                  <option value="ADMIN">مدير</option>
                  <option value="OWNER">مالك</option>
                </select>
              </Field>
              <Field label="تغيير الرمز (PIN)"><input name="pin" inputMode="numeric" dir="ltr" maxLength={6} placeholder="اتركه فارغ" className="select-base" /></Field>
              <Field label="الهدف الشهري"><input name="target" inputMode="numeric" dir="ltr" defaultValue={detail.targetDeals || ""} className="select-base" /></Field>
              <Field label="الحد الأقصى للعملاء"><input name="maxClients" inputMode="numeric" dir="ltr" defaultValue={detail.maxClients ?? ""} className="select-base" placeholder="اختياري" /></Field>
            </div>

            <Field label="المشاريع المسموح بيعها">
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
                {projects.length === 0 ? <span className="text-xs text-muted-foreground">ما فيه مشاريع</span> : projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={allowed.has(p.id)} onChange={(e) => setAllowed((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                    {p.name}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="ملاحظات خاصة"><textarea name="staffNotes" rows={2} defaultValue={detail.staffNotes ?? ""} className="select-base" /></Field>

            {/* دعوة الإيميل لتعيين الـ PIN */}
            {detail.email ? (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-foreground">دعوة تغيير الرمز</div>
                    <div className="text-xs text-muted-foreground">يُرسل رابط على إيميل الموظف لتعيين رمز الدخول.</div>
                  </div>
                  <button type="button" onClick={sendInvite} disabled={pending} className="shrink-0 rounded-xl border border-gold/40 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-50">إرسال دعوة</button>
                </div>
                {inviteMsg && <p className={`rounded-lg px-3 py-2 text-xs ${inviteMsg.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>{inviteMsg.text}</p>}
                <p className="text-[0.7rem] text-muted-foreground/70">لو غيّرت الإيميل، احفظ أولاً ثم أرسل الدعوة.</p>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">أضف إيميلًا واحفظ لتفعيل «إرسال دعوة» تغيير الرمز.</p>
            )}

            <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              <span className="text-foreground">الحساب مفعّل</span>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-[var(--gold)]" />
            </label>

            {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>}

            <div className="flex justify-between gap-2">
              <button type="button" onClick={() => setActive(false)} className="rounded-xl border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10">تعطيل الحساب</button>
              <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : "حفظ"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}
