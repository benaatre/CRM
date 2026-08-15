"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, Crosshair, MapPin, Power, SlidersHorizontal, Users } from "lucide-react";
import type { AttendanceLocation, AttendanceSettings } from "@prisma/client";
import { toArabicDigits } from "@/lib/format";
import { DEFAULT_RADIUS_M, splitCoords } from "@/lib/attendance-location-input";
import { minutesToTime, timeToMinutes } from "@/lib/attendance-ui";
import { WEEKDAY_CODES } from "@/lib/attendance-logic";
import { LiveTab, type LiveRow } from "@/components/attendance/attendance-live";
import { TeamTab } from "@/components/attendance/attendance-team";
import type { TeamSummaryRow } from "@/lib/data/attendance";

/**
 * لوحة «حوكمة الدوام» للمالك — أربعة تبويبات: مداوم الآن (الافتراضي) · الكل ·
 * المواقع · الإعدادات.
 *
 * كل تعديل يمرّ على مسارات `/api/attendance/*` المحميّة بـOWNER **على الخادم**؛
 * هذي الواجهة لا تملك صلاحية بذاتها، والصفحة نفسها محميّة بـrequireRole.
 * الذهبي هنا على عنصر واحد فقط: زر الفعل الرئيسي (أو حلقة العداد في «مداوم الآن»).
 */

type Tab = "live" | "team" | "locations" | "settings";

const TABS: { key: Tab; label: string; icon: typeof MapPin }[] = [
  { key: "live", label: "مداوم الآن", icon: Users },
  { key: "team", label: "الكل", icon: CalendarDays },
  { key: "locations", label: "المواقع", icon: MapPin },
  { key: "settings", label: "الإعدادات", icon: SlidersHorizontal },
];

const WEEKDAY_LABELS: Record<string, string> = {
  SUN: "الأحد",
  MON: "الاثنين",
  TUE: "الثلاثاء",
  WED: "الأربعاء",
  THU: "الخميس",
  FRI: "الجمعة",
  SAT: "السبت",
};

export function AttendanceAdmin({
  locations,
  settings,
  liveRows,
  teamMonth,
  teamRows,
}: {
  locations: AttendanceLocation[];
  settings: AttendanceSettings;
  liveRows: LiveRow[];
  teamMonth: string;
  teamRows: TeamSummaryRow[];
}) {
  const [tab, setTab] = useState<Tab>("live");

  return (
    <div className="space-y-5">
      {/* ===== التبويبات ===== */}
      <div role="tablist" aria-label="أقسام حوكمة الدوام" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? "border-foreground font-bold text-foreground"
                  : "border-transparent font-medium text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon aria-hidden size={16} strokeWidth={1.8} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "live" && <LiveTab initialRows={liveRows} />}
      {tab === "team" && <TeamTab initialMonth={teamMonth} initialRows={teamRows} />}
      {tab === "locations" && <LocationsTab locations={locations} />}
      {tab === "settings" && <SettingsTab settings={settings} />}
    </div>
  );
}

/* ═══════════════════ ١) المواقع ═══════════════════ */

function LocationsTab({ locations }: { locations: AttendanceLocation[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [type, setType] = useState<"HQ" | "PROJECT">("PROJECT");
  const [coords, setCoords] = useState("");
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS_M));
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  /** «موقعي الحالي» — قراءة واحدة تملأ حقل الإحداثيات. */
  const useMyLocation = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError("متصفحك ما يدعم تحديد الموقع");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords(`${pos.coords.latitude.toFixed(7)}, ${pos.coords.longitude.toFixed(7)}`);
        setLocating(false);
      },
      () => {
        setError("ما قدرنا نحدد موقعك — تأكد أنك سمحت بالوصول للموقع");
        setLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  const add = () => {
    setError(null);
    const pair = splitCoords(coords);
    if (!pair) {
      setError("الصق الإحداثيات بهذا الشكل: 24.6293, 46.5491");
      return;
    }
    start(async () => {
      const res = await fetch("/api/attendance/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, lat: pair.lat, lng: pair.lng, radiusMeters: Number(radius) }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "ما قدرنا نضيف الموقع");
        return;
      }
      setName("");
      setCoords("");
      setRadius(String(DEFAULT_RADIUS_M));
      router.refresh();
    });
  };

  const toggle = (loc: AttendanceLocation) => {
    start(async () => {
      await fetch(`/api/attendance/locations/${loc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !loc.isActive }),
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {/* نموذج الإضافة */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold text-foreground">إضافة موقع</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">اسم الموقع</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مشروع السلطان ٧٩"
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">النوع</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "HQ" | "PROJECT")}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
            >
              <option value="PROJECT">مشروع</option>
              <option value="HQ">مقر الشركة</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs text-muted-foreground">الإحداثيات — الصقها كما هي من الخرائط</span>
            <div className="flex gap-2">
              <input
                value={coords}
                onChange={(e) => setCoords(e.target.value)}
                placeholder="24.6293, 46.5491"
                dir="ltr"
                className="h-10 flex-1 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 text-xs font-medium text-foreground disabled:opacity-60"
              >
                <Crosshair aria-hidden size={15} strokeWidth={1.8} />
                {locating ? "جاري التحديد…" : "موقعي الحالي"}
              </button>
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">نصف القطر (متر)</span>
            <input
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              inputMode="numeric"
              dir="ltr"
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
            />
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        {/* العنصر الذهبي الوحيد في هذا التبويب */}
        <button
          type="button"
          onClick={add}
          disabled={pending}
          className="mt-4 h-11 w-full rounded-xl bg-gold text-sm font-bold text-primary-foreground disabled:opacity-60 sm:w-auto sm:px-8"
        >
          {pending ? "جاري الحفظ…" : "إضافة الموقع"}
        </button>
      </div>

      {/* الجدول */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[620px] text-right text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">الموقع</th>
              <th className="px-4 py-3 font-medium">النوع</th>
              <th className="px-4 py-3 font-medium">الإحداثيات</th>
              <th className="px-4 py-3 font-medium">النطاق</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  ما فيه مواقع بعد — أضف المقر أول
                </td>
              </tr>
            )}
            {locations.map((l) => (
              <tr key={l.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium text-foreground">{l.name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Building2 aria-hidden size={14} strokeWidth={1.8} />
                    {l.type === "HQ" ? "مقر الشركة" : "مشروع"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                  {l.lat.toFixed(5)}, {l.lng.toFixed(5)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {toArabicDigits(l.radiusMeters)} م
                </td>
                <td className="px-4 py-3">
                  <span className={l.isActive ? "text-success" : "text-muted-foreground"}>
                    {l.isActive ? "نشط" : "معطّل"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggle(l)}
                    disabled={pending}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground disabled:opacity-60"
                  >
                    <Power aria-hidden size={13} strokeWidth={1.8} />
                    {l.isActive ? "تعطيل" : "تشغيل"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════ ٢) الإعدادات ═══════════════════ */

function SettingsTab({ settings }: { settings: AttendanceSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [start_, setStart] = useState(minutesToTime(settings.workStartMinutes));
  const [end, setEnd] = useState(minutesToTime(settings.workEndMinutes));
  const [late, setLate] = useState(String(settings.lateThresholdMinutes));
  const [allowProject, setAllowProject] = useState(settings.allowProjectAttendance);
  const [accuracy, setAccuracy] = useState(String(settings.minAccuracyMeters));
  const [weekend, setWeekend] = useState<Set<string>>(
    () => new Set(settings.weekendDays.split(",").map((c) => c.trim()).filter(Boolean)),
  );
  const [noShow, setNoShow] = useState(String(settings.noShowAfterMinutes));
  const [verifyOn, setVerifyOn] = useState(settings.verificationEnabled);
  const [verifyPerDay, setVerifyPerDay] = useState(String(settings.verificationPerDay));
  const [verifyWindow, setVerifyWindow] = useState(String(settings.verificationWindowMinutes));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggleWeekendDay = (code: string) => {
    setWeekend((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const save = () => {
    setMsg(null);
    const s = timeToMinutes(start_);
    const e = timeToMinutes(end);
    if (s === null || e === null) {
      setMsg({ ok: false, text: "أوقات الدوام غير صحيحة" });
      return;
    }
    start(async () => {
      const res = await fetch("/api/attendance/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workStartMinutes: s,
          workEndMinutes: e,
          lateThresholdMinutes: Number(late),
          allowProjectAttendance: allowProject,
          minAccuracyMeters: Number(accuracy),
          weekendDays: [...weekend].join(","),
          noShowAfterMinutes: Number(noShow),
          verificationEnabled: verifyOn,
          verificationPerDay: Number(verifyPerDay),
          verificationWindowMinutes: Number(verifyWindow),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      setMsg(data.ok ? { ok: true, text: "انحفظت الإعدادات" } : { ok: false, text: data.error ?? "ما انحفظت" });
      if (data.ok) router.refresh();
    });
  };

  return (
    <div className="max-w-2xl space-y-4 rounded-2xl border border-border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">بداية الدوام</span>
          <input
            type="time"
            value={start_}
            onChange={(e) => setStart(e.target.value)}
            dir="ltr"
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">نهاية الدوام</span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            dir="ltr"
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">حد التأخير (دقيقة بعد بداية الدوام)</span>
          <input
            value={late}
            onChange={(e) => setLate(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">أسوأ دقة مقبولة (متر)</span>
          <input
            value={accuracy}
            onChange={(e) => setAccuracy(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
          />
        </label>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-border bg-secondary/50 p-3">
        <input
          type="checkbox"
          checked={allowProject}
          onChange={(e) => setAllowProject(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--gold)]"
        />
        <span>
          <span className="block text-sm font-medium text-foreground">اقبل الحضور من المشاريع</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            مطفأ يعني الحضور والانصراف الرسمي من المقر فقط — زيارات المشاريع تبقى شغّالة.
          </span>
        </span>
      </label>

      {/* ===== أيام الإجازة الأسبوعية ===== */}
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">أيام الإجازة الأسبوعية — تُستثنى من الغياب والحساب</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_CODES.map((code) => {
            const on = weekend.has(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                onClick={() => toggleWeekendDay(code)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {WEEKDAY_LABELS[code]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== «لم يداوم» ونداءات التحقق ===== */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">إشعار «لم يداوم» بعد (دقيقة من بداية دوامه)</span>
          <input
            value={noShow}
            onChange={(e) => setNoShow(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
          />
        </label>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-secondary/50 p-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={verifyOn}
            onChange={(e) => setVerifyOn(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--gold)]"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">نداءات التحقق العشوائية</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              إشعارات «أكّد موقعك» أثناء دوام الموظف — الرد قراءة موقع واحدة يتحقق منها الخادم.
            </span>
          </span>
        </label>
        {verifyOn && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">عدد النداءات باليوم</span>
              <input
                value={verifyPerDay}
                onChange={(e) => setVerifyPerDay(e.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">مهلة الرد (دقيقة)</span>
              <input
                value={verifyWindow}
                onChange={(e) => setVerifyWindow(e.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
          </div>
        )}
      </div>

      {msg && <p className={`text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>}

      {/* العنصر الذهبي الوحيد في هذا التبويب */}
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="h-11 w-full rounded-xl bg-gold text-sm font-bold text-primary-foreground disabled:opacity-60 sm:w-auto sm:px-8"
      >
        {pending ? "جاري الحفظ…" : "حفظ الإعدادات"}
      </button>
    </div>
  );
}

export default AttendanceAdmin;
