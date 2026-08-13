import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMyAttendanceStatus } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * حالة الموظف اليوم — جلسة مفتوحة؟ آخر بصمة؟ آخر موقع؟
 *
 * هوية الموظف من الجلسة حصرًا: لا يقدر أحد يقرأ حالة غيره من هنا (لوحة المالك
 * لها مسارها الخاص المحميّ بـOWNER). الأوقات تُصاغ على الخادم بتوقيت الرياض
 * فلا تختلف بين خادم وجهاز.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  const status = await getMyAttendanceStatus(session.user.id);
  return NextResponse.json({ ok: true, ...status });
}
