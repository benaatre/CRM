"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Crosshair, MapPin, Power, RotateCw, SlidersHorizontal, Users } from "lucide-react";
import type { AttendanceLocation, AttendanceSettings } from "@prisma/client";
import { toArabicDigits } from "@/lib/format";
import { DEFAULT_RADIUS_M, splitCoords } from "@/lib/attendance-location-input";
import type { AttendanceBoardRow } from "@/lib/data/attendance";

/**
 * لوحة «حوكمة الدوام» للمالك — ثلاثة تبويبات: المواقع · الإعدادات · اللوحة اللحظية.
 *
 * كل تعديل يمرّ على مسارات `/api/attendance/*` المحميّة بـOWNER **على الخادم**؛
 * هذي الواجهة لا تملك صلاحية بذاتها، والصفحة نفسها محميّة بـrequireRole.
 * الذهبي هنا على عنصر واحد فقط: زر الفعل الرئيسي للتبويب المعروض.
 */

type Tab = "locations" | "settings" | "board";

const TABS: { key: Tab; label: string; icon: typeof MapPin }[] = [
  { key: "locations", label: "المواقع", icon: MapPin },
  { key: "settings", label: "الإعدادات", icon: SlidersHorizontal },
  { key: "board", label: "اللوحة اللحظية", icon: Users },
];

/** دقائق من منتصف الليل ⟵ قيمة <input type="time"> والعكس. */
function minutesToTime(m: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60))}:${p(m % 60)}`;
}
function timeToMinutes(v: string): number | null {
  const [h, m] = v.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function AttendanceAdmin({
  locations,
  settings,
  board,
}: {
  locations: AttendanceLocation[];
  settings: AttendanceSettings;
  board: AttendanceBoardRow[];
}) {
  const [tab, setTab] = useState<Tab>("locations");

  return (
    <div className="space-y-5">
      {/* ===== التبويبات ===== */}
      <div role="tablist" aria-label="أقسام حوكمة الدوام" className="flex gap-1 border-b border-border">
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
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition-colors ${
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

      {tab === "locations" && <LocationsTab locations={locations} />}
      {tab === "settings" && <SettingsTab settings={settings} />}
      {tab === "board" && <BoardTab rows={board} />}
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

/* ═══════════════════ ٣) اللوحة اللحظية ═══════════════════ */

const BOARD_LABEL: Record<AttendanceBoardRow["status"], string> = {
  late: "حاضر متأخر",
  present: "حاضر",
  left: "منصرف",
  absent: "لم يسجّل",
};

const BOARD_CLASS: Record<AttendanceBoardRow["status"], string> = {
  late: "border-warning/40 text-warning",
  present: "border-success/40 text-success",
  left: "border-border text-muted-foreground",
  absent: "border-destructive/30 text-destructive",
};

function BoardTab({ rows }: { rows: AttendanceBoardRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">حالة اليوم — بتوقيت الرياض</p>
        <button
          type="button"
          onClick={() => start(() => router.refresh())}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground disabled:opacity-60"
        >
          <RotateCw aria-hidden size={13} strokeWidth={1.8} />
          {pending ? "جاري التحديث…" : "تحديث"}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          ما فيه موظفين نشطين
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="truncate font-bold text-foreground">{r.name}</span>
                <span className={`flex-none rounded-lg border px-2 py-1 text-[11px] font-bold ${BOARD_CLASS[r.status]}`}>
                  {BOARD_LABEL[r.status]}
                </span>
              </div>

              <div className="mt-2.5 space-y-1 text-xs text-muted-foreground">
                {r.startedAtText ? (
                  <p>
                    حضر {r.startedAtText}
                    {r.endedAtText ? ` · انصرف ${r.endedAtText}` : ""}
                    {r.workedMinutes != null
                      ? ` · ${toArabicDigits(Math.floor(r.workedMinutes / 60))} س ${toArabicDigits(r.workedMinutes % 60)} د`
                      : ""}
                  </p>
                ) : (
                  <p>ما سجّل حضور اليوم</p>
                )}
                {r.lastLocationName && <p>آخر موقع: {r.lastLocationName}</p>}
                {r.lastEventAtText && <p>آخر بصمة: {r.lastEventAtText}</p>}
                {r.outOfZoneToday && <p className="text-destructive">فيه محاولة بصم خارج النطاق اليوم</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AttendanceAdmin;
