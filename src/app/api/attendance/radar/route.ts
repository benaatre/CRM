import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { getLocationRadar } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * رادار المواقع الحية (الحضور بالرادار — ر٤) — المالك فقط. لكل موقع من داخله
 * الآن (آخر نبضة inZone حديثة + جلسة مفتوحة). طبقة عرض على النبضات القائمة.
 */
export async function GET() {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;
  return NextResponse.json({ ok: true, ...(await getLocationRadar()) });
}
