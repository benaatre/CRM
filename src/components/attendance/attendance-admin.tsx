"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, Crosshair, MapPin, Power, SlidersHorizontal, Users } from "lucide-react";
import type { AttendanceLocation } from "@prisma/client";
import { toArabicDigits } from "@/lib/format";
import { DEFAULT_RADIUS_M, splitCoords } from "@/lib/attendance-location-input";
import { LiveTab } from "@/components/attendance/attendance-live";
import type { LocationRadar } from "@/lib/data/attendance";
import { TeamTab } from "@/components/attendance/attendance-team";
import type { LiveBoardPayload, TeamSummaryRow } from "@/lib/data/attendance";

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

export function AttendanceAdmin({
  locations,
  live,
  radar,
  teamMonth,
  teamRows,
  readOnly = false,
}: {
  locations: AttendanceLocation[];
  live: LiveBoardPayload;
  radar: LocationRadar;
  teamMonth: string;
  teamRows: TeamSummaryRow[];
  /** HR/FINANCE: مشاهدة فقط — تبويبا المواقع والإعدادات (كتابة) يُخفيان، والخادم يصدهما أصلًا. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("live");
  const visibleTabs = readOnly ? TABS.filter((t) => t.key === "live" || t.key === "team") : TABS;

  return (
    <div className="space-y-5">
      {/* ===== التبويبات ===== */}
      <div role="tablist" aria-label="أقسام حوكمة الدوام" className="flex gap-1 overflow-x-auto border-b border-border">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={active}
              // «الإعدادات» خلَفها مركز التحكم — لا سطحين إعدادات (الدفعة أ).
              onClick={() => (t.key === "settings" ? router.push("/attendance/control") : setTab(t.key))}
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

      {tab === "live" && <LiveTab initial={live} radar={radar} />}
      {tab === "team" && <TeamTab initialMonth={teamMonth} initialRows={teamRows} />}
      {tab === "locations" && !readOnly && <LocationsTab locations={locations} />}
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

/* ═══════════════════ جهات الإذن ═══════════════════ */

type Authorizer = { id: string; label: string; isActive: boolean; sortOrder: number };

/**
 * إدارة جهات الإذن بالخروج — قائمة شاشة «مين أذن لك؟» عند الموظف.
 * الحذف تعطيل لا مسحًا: سجلات التوقف تحمل نسخة نصية من الاسم فتبقى مقروءة.
 */
export function AuthorizersSection() {
  const [list, setList] = useState<Authorizer[] | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/attendance/authorizers?all=1", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; authorizers?: Authorizer[] };
      if (data.ok && data.authorizers) setList(data.authorizers);
    } catch {
      /* تُعاد المحاولة بأي عملية قادمة */
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const call = async (input: RequestInfo, init?: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(input, init);
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "ما نفذت العملية");
      await load();
    } catch {
      setError("تعذّر الاتصال — حاول مرة ثانية");
    }
    setBusy(false);
  };

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    setNewLabel("");
    void call("/api/attendance/authorizers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
  };

  const move = (a: Authorizer, dir: -1 | 1) => {
    if (!list) return;
    const active = list.filter((x) => x.isActive);
    const i = active.findIndex((x) => x.id === a.id);
    const other = active[i + dir];
    if (!other) return;
    void (async () => {
      await call(`/api/attendance/authorizers/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: other.sortOrder }),
      });
      await call(`/api/attendance/authorizers/${other.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: a.sortOrder }),
      });
    })();
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-secondary/50 p-3">
      <div>
        <span className="block text-sm font-medium text-foreground">جهات الإذن بالخروج</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          القائمة التي يختار منها الموظف «مين أذن لك؟» — الحذف تعطيل يحفظ السجلات القديمة.
        </span>
      </div>

      <div className="flex gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="اسم الجهة — مثال: الإدارة"
          className="h-10 flex-1 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !newLabel.trim()}
          className="h-10 rounded-xl border border-border px-4 text-xs font-bold text-foreground disabled:opacity-50"
        >
          إضافة
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {list === null ? (
        <p className="py-2 text-xs text-muted-foreground">جاري تحميل الجهات…</p>
      ) : list.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">ما فيه جهات بعد — أضف الأولى فوق</p>
      ) : (
        <ul className="space-y-1">
          {list.map((a) => (
            <li
              key={a.id}
              className={`flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 ${a.isActive ? "" : "opacity-50"}`}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{a.label}</span>
              {a.isActive ? (
                <>
                  <button
                    type="button"
                    onClick={() => move(a, -1)}
                    disabled={busy}
                    aria-label="فوق"
                    className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground disabled:opacity-50"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(a, 1)}
                    disabled={busy}
                    aria-label="تحت"
                    className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground disabled:opacity-50"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void call(`/api/attendance/authorizers/${a.id}`, { method: "DELETE" })
                    }
                    disabled={busy}
                    className="rounded-lg border border-destructive/40 px-2.5 py-1 text-xs font-bold text-destructive disabled:opacity-50"
                  >
                    تعطيل
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    void call(`/api/attendance/authorizers/${a.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ isActive: true }),
                    })
                  }
                  disabled={busy}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-foreground disabled:opacity-50"
                >
                  تفعيل
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AttendanceAdmin;
