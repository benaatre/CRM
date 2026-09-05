"use client";

import { useState, useTransition } from "react";
import { Search, UserPlus, UserCheck, Handshake } from "lucide-react";
import {
  financePhoneLookup, financeRegisterLead, type FinanceLookupMatch,
} from "@/lib/actions/finance-clients";
import { BookingForm } from "@/components/bookings/booking-form";

/**
 * شاشة بحث المالي برقم الجوال (سلطة المالي — البند ٦):
 * موجود ⇒ «العميل مسجل لدى: فلان» بالحد الأدنى (اسم + موظف، لا فتح ملف).
 * غير موجود ⇒ نموذج تسجيل عميل جديد بإسناده لموظف نشط.
 */
export function FinanceClientSearch({ sellers }: { sellers: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [matches, setMatches] = useState<FinanceLookupMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // نموذج التسجيل الجديد
  const [name, setName] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [registered, setRegistered] = useState<{ leadId: string; name: string; employeeName: string } | null>(null);
  // سلطة المالي (البند ٧): فتح نموذج الحجز لعميل موجود بالبحث أو مسجَّل للتو.
  const [bookingFor, setBookingFor] = useState<{ leadId: string; leadName: string } | null>(null);

  function search() {
    setError(null); setMatches(null); setRegistered(null); setSearched(null);
    const p = phone.trim();
    if (!p) { setError("اكتب رقم الجوال"); return; }
    startTransition(async () => {
      const res = await financePhoneLookup(p);
      if (!res.ok) { setError(res.error); return; }
      setSearched(p);
      setMatches(res.matches);
      setName(""); setAssignedToId("");
    });
  }

  function register(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("phone", searched ?? phone);
    startTransition(async () => {
      const res = await financeRegisterLead(fd);
      if (!res.ok) { setError(res.error); return; }
      setRegistered({ leadId: res.leadId, name: String(fd.get("name") ?? ""), employeeName: res.employeeName });
      setMatches(null);
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="glass rounded-2xl p-5">
        <h1 className="text-xl font-bold text-foreground">بحث برقم الجوال</h1>
        <p className="mt-1 text-sm text-muted-foreground">تحقق من وجود العميل قبل تسجيل بيعة — وإن كان جديدًا سجّله وأسنده لموظفه.</p>
        <div className="mt-4 flex gap-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
            inputMode="tel" dir="ltr" placeholder="05xxxxxxxx"
            className="select-base flex-1"
          />
          <button onClick={search} disabled={pending} className="flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            <Search className="size-4" /> ابحث
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </header>

      {/* موجود: الحد الأدنى — الاسم والموظف فقط، لا فتح ملف */}
      {matches && matches.length > 0 && (
        <section className="glass space-y-2 rounded-2xl p-5">
          <h2 className="flex items-center gap-2 font-semibold text-foreground"><UserCheck className="size-4 text-gold" /> العميل مسجل في النظام</h2>
          {matches.map((m) => (
            <div key={m.leadId} className="flex items-center justify-between gap-2 rounded-xl border border-border px-4 py-3">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{m.name}</span>
                <span className="block text-sm text-muted-foreground">{m.employeeName ? `لدى: ${m.employeeName}` : "غير موزّع"}</span>
              </div>
              <button onClick={() => setBookingFor({ leadId: m.leadId, leadName: m.name })} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-xs font-medium text-gold hover:bg-gold/20">
                <Handshake className="size-3.5" /> سجّل حجزًا
              </button>
            </div>
          ))}
        </section>
      )}

      {/* غير موجود: نموذج تسجيل عميل جديد بإسناده لموظف */}
      {matches && matches.length === 0 && !registered && (
        <section className="glass rounded-2xl p-5">
          <h2 className="flex items-center gap-2 font-semibold text-foreground"><UserPlus className="size-4 text-gold" /> غير مسجل — سجّله الآن</h2>
          <form onSubmit={register} className="mt-3 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">اسم العميل *</span>
              <input name="name" value={name} onChange={(e) => setName(e.target.value)} required className="select-base" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">رقم الجوال</span>
              <input value={searched ?? ""} disabled dir="ltr" className="select-base opacity-70" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">الموظف المسؤول *</span>
              <select name="assignedToId" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} required className="select-base">
                <option value="" disabled>اختر الموظف</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {pending ? "جارٍ…" : "سجّل العميل وأسنده"}
            </button>
          </form>
        </section>
      )}

      {registered && (
        <section className="glass space-y-3 rounded-2xl p-5">
          <p className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
            سُجّل «{registered.name}» وأُسند لـ{registered.employeeName} — ووصله إشعار بذلك.
          </p>
          <button onClick={() => setBookingFor({ leadId: registered.leadId, leadName: registered.name })} className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-gold/50 bg-gold/10 text-sm font-semibold text-gold hover:bg-gold/20">
            <Handshake className="size-4" /> سجّل حجزًا له الآن
          </button>
        </section>
      )}

      {/* نموذج الحجز — البيعة تُنسب إلزاميًا لموظف من القائمة (الخادم يلزم FINANCE به) */}
      {bookingFor && (
        <BookingForm
          open={!!bookingFor}
          leadId={bookingFor.leadId}
          leadName={bookingFor.leadName}
          sellers={sellers}
          onClose={() => setBookingFor(null)}
          onDone={() => { setBookingFor(null); setMatches(null); setRegistered(null); setSearched(null); setPhone(""); }}
        />
      )}
    </div>
  );
}
