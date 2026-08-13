/**
 * حساب النطاق الجغرافي للدوام — مصدر الحقيقة الوحيد للمسافة والمطابقة.
 *
 * قاعدة قاطعة: هذي الدوال تُستدعى **على الخادم** في كل بصمة. لا نثق أبدًا بأي
 * «أنا داخل الدائرة» قادم من الجوال — الجوال يرسل إحداثيات ودقّة فقط، والخادم
 * يعيد الحساب ويقرّر.
 *
 * وحدة نقيّة (بلا "server-only" وبلا Prisma) — تصلح للخادم والسكربتات معًا،
 * على نمط `ksa-time.ts`.
 */

/** نصف قطر الأرض بالأمتار (كرة متوسطة) — كافٍ لمسافات المئات من الأمتار. */
const EARTH_RADIUS_M = 6371000;

/** حساب المسافة بالأمتار بين نقطتين — Haversine. */
export function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = EARTH_RADIUS_M;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** الحد الأدنى لموقع قابل للمطابقة — الشكل الذي تحتاجه الدالة لا أكثر. */
export type GeoZone = {
  id: string;
  lat: number;
  lng: number;
  radiusMeters: number;
};

/**
 * يرجّع أقرب موقع تكون النقطة داخله (مع هامش الدقة)، أو null لو خارج الجميع.
 *
 * هامش الدقة (`accuracy`) يُضاف لنصف القطر: قراءة دقّتها ٤٠م تعني أن الموظف قد
 * يكون فعلًا داخل الدائرة وإن ظهر مركزه خارجها بأربعين مترًا — نمنح الشك لصالحه،
 * والدقّة السيئة أصلًا مرفوضة قبل هذي الخطوة (minAccuracyMeters).
 */
export function matchLocation(
  lat: number,
  lng: number,
  accuracy: number,
  locations: GeoZone[],
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null;
  for (const loc of locations) {
    const d = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (d <= loc.radiusMeters + accuracy) {
      if (!best || d < best.distance) best = { id: loc.id, distance: d };
    }
  }
  return best;
}

/**
 * أقرب موقع مطلقًا (ولو كان خارج دائرته) + مسافته — لرسالة «أنت خارج الموقع»
 * ولتسجيل `distanceMeters` في البصمة الخارجة عن النطاق بدل صفر بلا معنى.
 */
export function nearestLocation(
  lat: number,
  lng: number,
  locations: GeoZone[],
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null;
  for (const loc of locations) {
    const d = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (!best || d < best.distance) best = { id: loc.id, distance: d };
  }
  return best;
}
