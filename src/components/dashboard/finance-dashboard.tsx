import Link from "next/link";
import { Coins, Wallet, Users2, Handshake, BadgeCheck, MapPin, Trophy, Radio, AlertTriangle } from "lucide-react";
import type { FinanceDashboardData } from "@/lib/data/finance-dashboard";
import { LEAVE_LABEL } from "@/lib/data/leaves";
import type { HrExtrasData } from "@/lib/data/finance-dashboard";
import { formatCount, formatCurrency, toArabicDigits } from "@/lib/format";
import { AttendanceCard } from "@/components/attendance/attendance-card";
import { OwnerAttendance } from "@/components/owner/owner-attendance";
import { OD_TOKENS } from "@/components/owner/owner-dashboard";

/**
 * داشبورد المدير المالي (قرار 2026-08-20) — بالترتيب المعتمد حرفيًا:
 * ١) الأرقام الأساسية (بلا «غير الموزّعين») ٢) الدوام (بطاقته + شريط الفريق
 * القرائي) ٣) الأمور المالية ٤) المبيعات (المراحل + نجم الأسبوع + المتصلين).
 * لا متابعات ولا توزيع ولا أي عنصر عملاء.
 */
export function FinanceDashboard({ data }: { data: FinanceDashboardData }) {
  const k = data.kpis;
  const kpiTiles = [
    { label: "إجمالي العملاء", value: formatCount(k.totalClients.value), icon: Users2, accent: "text-gold" },
    { label: "الحجوزات", value: formatCount(k.bookings.value), icon: Handshake, accent: "text-info" },
    { label: "صفقات مقفولة", value: formatCount(k.closedWon.value), icon: BadgeCheck, accent: "text-success" },
    { label: "الزيارات", value: formatCount(k.visits.value), icon: MapPin, accent: "text-warning" },
    { label: "نسبة التحويل", value: `${toArabicDigits(k.conversion.value)}٪`, icon: Coins, accent: "text-gold" },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">لوحة المدير المالي</h1>
          <p className="mt-1 text-sm text-muted-foreground">الأرقام والتحصيل والمبيعات — بلا شؤون توزيع العملاء</p>
        </div>
      </header>

      {/* ===== ١) الأرقام الأساسية — نسخة مالية (بلا «غير موزّعين») ===== */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {kpiTiles.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="glass rounded-2xl p-4">
              <Icon className={`size-5 ${t.accent}`} />
              <div className={`mt-2 text-lg font-bold ${t.accent}`} style={{ fontVariantNumeric: "tabular-nums" }}>{t.value}</div>
              <div className="text-xs text-muted-foreground">{t.label}</div>
            </div>
          );
        })}
      </section>

      {/* ===== ٢) الدوام: بطاقته الشخصية + شريط دوام الفريق (قراءة) ===== */}
      <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold text-foreground">دوامك</h2>
          <AttendanceCard theme="web" />
        </div>
        <div style={OD_TOKENS}>
          <OwnerAttendance isOwner />
        </div>
      </section>

      {/* ===== ٣) الأمور المالية ===== */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded bg-gold" />
          <h2 className="text-lg font-bold text-foreground">الأمور المالية</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {/* ملخص التحصيل */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground"><Wallet className="size-4 text-gold" /> ملخص التحصيل</div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">المحصّل</span><b className="text-success">{formatCurrency(data.collection.collected)}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">المتبقي</span><b className="text-warning">{formatCurrency(data.collection.remaining)}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي</span><b className="text-foreground">{formatCurrency(data.collection.total)}</b></div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-success" style={{ width: `${data.collection.pct}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">{toArabicDigits(data.collection.pct)}٪ من قيمة الحجوزات محصّلة</div>
          </div>

          {/* آخر دفعات التحصيل */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground"><Coins className="size-4 text-gold" /> آخر دفعات التحصيل</div>
            <div className="mt-3 space-y-2.5">
              {data.recentPayments.length === 0 && <p className="text-xs text-muted-foreground">ما فيه دفعات مسجّلة بعد.</p>}
              {data.recentPayments.map((p, i) => (
                <div key={i} className="border-b border-border/60 pb-2 text-xs leading-6 last:border-0 last:pb-0">
                  <div className="text-foreground">{p.summary}</div>
                  <div className="text-muted-foreground">{p.byName} · {p.whenText}</div>
                </div>
              ))}
            </div>
          </div>

          {/* تحتاج انتباهك */}
          <div className="rounded-2xl border border-warning/40 bg-warning/5 p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-warning"><AlertTriangle className="size-4" /> قريبة من التسليم وتحصيلها غير مكتمل</div>
            <div className="mt-3 space-y-2.5">
              {data.attention.length === 0 && <p className="text-xs text-muted-foreground">كل المبيعات القريبة من التسليم محصّلة ✓</p>}
              {data.attention.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-card px-3 py-2 text-xs leading-6">
                  <div className="flex justify-between gap-2">
                    <b className="text-foreground">{a.leadName}</b>
                    <span className="text-muted-foreground">{a.stageLabel}</span>
                  </div>
                  <div className="text-muted-foreground">{a.unitLabel}</div>
                  <div>المتبقي <b className="text-warning">{formatCurrency(a.remaining)}</b> · محصّل {formatCurrency(a.collected)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== ٤) المبيعات ===== */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded bg-info" />
          <h2 className="text-lg font-bold text-foreground">المبيعات</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">خط المبيعات بمراحله</span>
              <Link href="/bookings" className="text-xs text-gold hover:underline">فتح خط المبيعات ←</Link>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
              {data.stageCounts.map((s) => (
                <div key={s.stage} className="rounded-xl bg-secondary/50 p-3 text-center">
                  <div className="text-lg font-bold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>{toArabicDigits(s.count)}</div>
                  <div className="mt-1 text-[10.5px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-gold/40 bg-gold/5 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-gold"><Trophy className="size-4" /> نجم الأسبوع</div>
              <div className="mt-2 text-lg font-bold text-foreground">{data.weekStar?.name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{data.weekStar?.isCurrentWeek ? "صدارة لوحة الأسبوع الجارية" : "آخر أسبوع مكتمل"}</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground"><Radio className="size-4 text-success" /> مين متصل الآن</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.online.length === 0 && <span className="text-xs text-muted-foreground">ما فيه أحد متصل الآن.</span>}
                {data.online.map((u) => (
                  <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs text-success">
                    <span className="size-1.5 rounded-full bg-success" /> {u.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** إضافات داشبورد HR — دوام الفريق اليوم (قرائي) + طلبات الإجازة بانتظاره. */
export function HrExtras({ data }: { data: HrExtrasData }) {
  return (
    <section className="mx-auto mt-8 max-w-[1400px] space-y-4">
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 rounded bg-gold" />
        <h2 className="text-lg font-bold text-foreground">الموارد البشرية</h2>
      </div>
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-foreground">طلبات إجازة بانتظارك</span>
            <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-bold text-warning" style={{ fontVariantNumeric: "tabular-nums" }}>
              {toArabicDigits(data.pendingLeaves.length)}
            </span>
          </div>
          {data.pendingLeaves.length === 0 ? (
            <p className="text-xs text-muted-foreground">ما فيه طلبات معلّقة.</p>
          ) : (
            <div className="space-y-2">
              {data.pendingLeaves.map((l) => (
                <Link
                  key={l.id}
                  href={`/employees/${l.userId}`}
                  className="block rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs leading-6 transition-colors hover:border-gold/40"
                >
                  <b className="text-foreground">{l.userName}</b>
                  <span className="text-muted-foreground"> · {LEAVE_LABEL[l.typeKey] ?? l.typeKey} · {l.fromKey} ← {l.toKey}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div style={OD_TOKENS}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-foreground">دوام الفريق اليوم</span>
            <Link href="/attendance" className="text-xs text-gold hover:underline">حوكمة الدوام ←</Link>
          </div>
          <OwnerAttendance isOwner />
        </div>
      </div>
    </section>
  );
}
