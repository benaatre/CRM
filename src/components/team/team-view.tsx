"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Upload, Shuffle, X, Loader2 } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import type { TeamData } from "@/lib/data/team";
import { addEmployee, distributeUnassigned, toggleEmployeeActive } from "@/lib/actions/team";
import { importLeads } from "@/lib/actions/import";

type Employee = { id: string; name: string };

export function TeamView({ data, employees }: { data: TeamData; employees: Employee[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  function distribute() {
    setMsg(null);
    startTransition(async () => {
      const res = await distributeUnassigned();
      setMsg(res.ok ? res.message ?? "تم التوزيع" : res.error ?? "صار خطأ");
      router.refresh();
    });
  }

  function setActive(id: string, active: boolean) {
    startTransition(async () => {
      await toggleEmployeeActive(id, active);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الفريق والتوزيع</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {toArabicDigits(data.members.length)} موظف · {toArabicDigits(data.unassigned)} عميل غير موزّع
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            <Upload className="size-4" /> استيراد عملاء
          </button>
          <button
            onClick={distribute}
            disabled={pending || data.unassigned === 0}
            className="flex items-center gap-2 rounded-xl border border-gold/40 px-3 py-2 text-sm text-gold hover:bg-gold/10 disabled:opacity-40"
          >
            <Shuffle className="size-4" /> وزّع غير الموزّعين ({toArabicDigits(data.unassigned)})
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            <UserPlus className="size-4" /> أضف موظف
          </button>
        </div>
      </header>

      {msg && <div className="rounded-xl bg-secondary px-4 py-2 text-sm text-foreground">{msg}</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.members.map((m) => (
          <div key={m.id} className={`glass rounded-2xl p-5 ${m.active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-foreground">{m.name}</h3>
                {m.phone && <p className="text-xs text-muted-foreground" dir="ltr">{m.phone}</p>}
              </div>
              <button
                onClick={() => setActive(m.id, !m.active)}
                disabled={pending}
                className={`rounded-full px-2 py-0.5 text-xs ${m.active ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}
              >
                {m.active ? "مفعّل" : "موقوف"}
              </button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <Stat label="عملاء" value={m.total} />
              <Stat label="مقفول" value={m.closed} className="text-success" />
              <Stat label="حجوزات" value={m.bookings} className="text-gold" />
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              الهدف: {m.target > 0 ? toArabicDigits(m.target) + " صفقة" : "—"}
            </div>
          </div>
        ))}
        {data.members.length === 0 && (
          <p className="col-span-full py-8 text-center text-muted-foreground">ما فيه موظفين بعد.</p>
        )}
      </div>

      {showAdd && <AddEmployeeDialog onClose={() => setShowAdd(false)} />}
      {showImport && <ImportDialog onClose={() => setShowImport(false)} employees={employees} />}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 py-2">
      <div className={`text-base font-bold ${className ?? "text-foreground"}`}>{toArabicDigits(value)}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function AddEmployeeDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addEmployee(fd);
      if (res.ok) { router.refresh(); onClose(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <Modal title="موظف جديد" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="الاسم *"><input name="name" required className="select-base" placeholder="اسم الموظف" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="الجوال"><input name="phone" inputMode="numeric" dir="ltr" className="select-base" placeholder="05xxxxxxxx" /></Field>
          <Field label="رمز PIN *"><input name="pin" inputMode="numeric" dir="ltr" maxLength={6} className="select-base" placeholder="٤–٦ أرقام" /></Field>
        </div>
        <Field label="الهدف (صفقات)"><input name="target" inputMode="numeric" dir="ltr" className="select-base" placeholder="مثال: 10" /></Field>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
          <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {pending ? "جارٍ…" : "أضف"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImportDialog({ onClose, employees }: { onClose: () => void; employees: Employee[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await importLeads(fd);
      if (res.ok) {
        setResult(`تم استيراد ${toArabicDigits(res.created ?? 0)} عميل` + (res.skipped ? ` · تخطّيت ${toArabicDigits(res.skipped)} صف` : ""));
        router.refresh();
      } else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <Modal title="استيراد عملاء" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-muted-foreground">
          ملف CSV أو Excel، الصف الأول عناوين. لازم عمودي «الاسم» و«الجوال». الأعمدة الاختيارية: القناة، المشروع، نوع الوحدة، الميزانية، المرحلة، الأولوية، ملاحظات.
        </p>
        <Field label="الملف *">
          <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-foreground" />
        </Field>
        <Field label="الإسناد">
          <select name="assignMode" className="select-base" defaultValue="self">
            <option value="self">لي أنا</option>
            <option value="roundrobin">توزيع بالتساوي على الموظفين</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </Field>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>}
        {result && <p className="rounded-lg bg-success/10 px-3 py-2 text-center text-sm text-success">{result}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground">إغلاق</button>
          <button type="submit" disabled={pending} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {pending && <Loader2 className="size-4 animate-spin" />} استورد
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
