import { AttendanceLocationType } from "@prisma/client";

/**
 * تحقّق حقول موقع الدوام — وحدة مستقلة لأن ملف route.ts في App Router لا يقبل
 * تصديرات خارج دوال HTTP وإعداداتها.
 */

/** حدود نصف القطر — أقل من ٢٠م تخنق دقّة GPS، وأكثر من ٥كم تلغي معنى النطاق. */
export const MIN_RADIUS_M = 20;
export const MAX_RADIUS_M = 5000;
export const DEFAULT_RADIUS_M = 150;

const TYPES = new Set<string>(Object.values(AttendanceLocationType));

export type LocationInput = {
  name: string;
  type: AttendanceLocationType;
  lat: number;
  lng: number;
  radiusMeters: number;
};

/**
 * يتحقق من حقول الموقع ويرجّع رسالة عربية عند الخطأ.
 * `partial=true` للتعديل الجزئي (PATCH): الحقول الغائبة تُترك كما هي.
 */
export function parseLocation(
  raw: Record<string, unknown>,
  partial = false,
): { ok: true; data: Partial<LocationInput> } | { ok: false; error: string } {
  const data: Partial<LocationInput> = {};

  if (raw.name !== undefined || !partial) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (name.length < 2 || name.length > 120) return { ok: false, error: "اكتب اسم الموقع" };
    data.name = name;
  }
  if (raw.type !== undefined || !partial) {
    const type = typeof raw.type === "string" ? raw.type : "";
    if (!TYPES.has(type)) return { ok: false, error: "نوع الموقع غير صحيح" };
    data.type = type as AttendanceLocationType;
  }
  if (raw.lat !== undefined || !partial) {
    const lat = Number(raw.lat);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: "خط العرض غير صحيح" };
    data.lat = lat;
  }
  if (raw.lng !== undefined || !partial) {
    const lng = Number(raw.lng);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: "خط الطول غير صحيح" };
    data.lng = lng;
  }
  if (raw.radiusMeters !== undefined || !partial) {
    const r = Math.round(Number(raw.radiusMeters));
    if (!Number.isFinite(r) || r < MIN_RADIUS_M || r > MAX_RADIUS_M) {
      return { ok: false, error: `نصف القطر بين ${MIN_RADIUS_M} و${MAX_RADIUS_M} متر` };
    }
    data.radiusMeters = r;
  }

  return { ok: true, data };
}

/**
 * يفصل إحداثيات ملصوقة «24.6293, 46.5491» (أو بمسافة/شرطة مائلة) لزوج أرقام.
 * يرجّع null لو النص ما فيه رقمان صالحان — الواجهة تعرض رسالتها وقتها.
 */
export function splitCoords(raw: string): { lat: number; lng: number } | null {
  const nums = raw
    .replace(/[°‏‎]/g, " ")
    .split(/[,\s/|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.length < 2) return null;
  const [lat, lng] = nums;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
