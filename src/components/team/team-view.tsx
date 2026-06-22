"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Upload, Shuffle, X } from "lucide-react";
import type { Role } from "@prisma/client";
import { roleLabel } from "@/lib/labels";
import { toArabicDigits } from "@/lib/format";
import type { TeamData } from "@/lib/data/team";
import { addEmployee, distributeUnassigned, toggleEmployeeActive } from "@/lib/actions/team";
import { ImportDialog } from "./import-dialog";
import { EmployeeSettingsDialog } from "./employee-settings-dialog";

type Employee = { id: string; name: string };

const roleBadge: Record<Role, string> = {
  OWNER: "bg-gold/15 text-gold",
  ADMIN: "bg-info/15 text-info",
  EMPLOYEE: "bg-secondary text-muted-foreground",
};

export function TeamView({ data, employees }: { data: TeamData; employees: Employee[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDist, setShowDist] = useState(false);
  const [editEmp, setEditEmp] = useState<string | null>(null);

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
            {toArabicDigits(data.employeeCount)} موظف · {toArabicDigits(data.unassigned)} عميل غير موزّع
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            <Upload className="size-4" /> استيراد عملاء
          </button>
          <button onClick={() => setShowDist(true)} disabled={data.unassigned === 0} className="flex items-center gap-2 rounded-xl border border-gold/40 px-3 py-2 text-sm text-gold hover:bg-gold/10 disabled:opacity-40">
            <Shuffle className="size-4" /> توزيع ({toArabicDigits(data.unassigned)})
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            <UserPlus className="size-4" /> إضافة موظف
          </button>
        </div>
      </header>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-right text-sm">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">الاسم</th>
              <th className="px-4 py-3 font-medium">الجوال</th>
              <th className="px-4 py-3 font-medium">الدور</th>
              <th className="px-4 py-3 font-medium">عملاء</th>
              <th className="px-4 py-3 font-medium">مقفول</th>
              <th className="px-4 py-3 font-medium">الهدف</th>
              <th className="px-4 py-3 font-medium">النشاط</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.id} onClick={() => setEditEmp(m.id)} className={`cursor-pointer border-t border-border transition-colors hover:bg-secondary/40 ${m.active ? "" : "opacity-50"}`}>
                <td className="px-4 py-3 font-medium text-foreground">{m.name}</td>
                <td className="px-4 py-3 text-muted-foreground" dir="ltr">{m.phone ?? "—"}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${roleBadge[m.role]}`}>{roleLabel(m.role)}</span></td>
                <td className="px-4 py-3 text-muted-foreground">{toArabicDigits(m.total)}</td>
                <td className="px-4 py-3 text-success">{toArabicDigits(m.closed)}</td>
                <td className="px-4 py-3 text-gold">{m.target > 0 ? toArabicDigits(m.target) : "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-gold" style={{ width: `${m.activityRate}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{toArabicDigits(m.activityRate)}٪</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {m.role === "EMPLOYEE" ? (
                    <button onClick={(e) => { e.stopPropagation(); setActive(m.id, !m.active); }} disabled={pending} className={`rounded-full px-2 py-0.5 text-xs ${m.active ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
                      {m.active ? "مفعّل" : "موقوف"}
                    </button>
                  ) : (
                    <span className="text-xs text-success">مفعّل</span>
                  )}
                </td>
              </tr>
            ))}
            {data.members.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">ما فيه موظفين بعد.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddEmployeeDialog onClose={() => setShowAdd(false)} />}
      {showImport && <ImportDialog onClose={() => setShowImport(false)} employees={employees} />}
      {showDist && <DistributeDialog onClose={() => setShowDist(false)} unassigned={data.unassigned} empCount={data.employeeCount} />}
      {editEmp && <EmployeeSettingsDialog userId={editEmp} onClose={() => setEditEmp(null)} />}
    </div>
  );
}

function DistributeDialog({ onClose, unassigned, empCount }: { onClose: () => void; unassigned: number; empCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"equal" | "count">("equal");
  const [perEmp, setPerEmp] = useState("5");
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const res = await distributeUnassigned(mode === "count" ? Number(perEmp) || 0 : undefined);
      setMsg(res.ok ? res.message ?? "تم" : res.error ?? "صار خطأ");
      router.refresh();
    });
  }

  return (
    <Modal title="توزيع العملاء غير الموزّعين" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{toArabicDigits(unassigned)} عميل · {toArabicDigits(empCount)} موظف مفعّل</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={mode === "equal"} onChange={() => setMode("equal")} />
          بالتساوي على الجميع
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={mode === "count"} onChange={() => setMode("count")} />
          عدد محدد لكل موظف:
          <input value={perEmp} onChange={(e) => setPerEmp(e.target.value.replace(/\D/g, ""))} disabled={mode !== "count"} inputMode="numeric" dir="ltr" className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm disabled:opacity-50" />
        </label>
        {msg && <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">{msg}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground">إغلاق</button>
          <button onClick={run} disabled={pending} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : "وزّع"}</button>
        </div>
      </div>
    </Modal>
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
          <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : "أضف"}</button>
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
