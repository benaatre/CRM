import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getMyAttendanceStatus } from "@/lib/data/attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** إصدار نص الإفصاح الحالي — نفس القيمة التي يكتبها POST /api/attendance/consent. */
const CONSENT_VERSION = "attendance_location_disclosure_v3";

/**
 * حالة الموظف اليوم — جلسة مفتوحة؟ آخر بصمة؟ آخر موقع؟
 *
 * هوية الموظف من الجلسة حصرًا: لا يقدر أحد يقرأ حالة غيره من هنا (لوحة المالك
 * لها مسارها الخاص المحميّ بـOWNER). الأوقات تُصاغ على الخادم بتوقيت الرياض
 * فلا تختلف بين خادم وجهاز.
 *
 * `consented`: هل لهذا المستخدم سجل PRIVACY_CONSENT بالإصدار الحالي —
 * الموافقة صارت خادمية الحقيقة (تتبع المستخدم لا الجهاز)، وlocalStorage
 * بالواجهة كاش تفاؤلي فقط. قراءة خفيفة على فهرس [resourceType, resourceId].
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  const [status, consentRow] = await Promise.all([
    getMyAttendanceStatus(session.user.id),
    prisma.auditEvent.findFirst({
      where: { action: "PRIVACY_CONSENT", resourceType: "user", resourceId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { after: true },
    }),
  ]);
  const consented =
    !!consentRow &&
    typeof consentRow.after === "object" &&
    consentRow.after !== null &&
    (consentRow.after as { consent?: string }).consent === CONSENT_VERSION;

  return NextResponse.json({ ok: true, consented, ...status });
}
