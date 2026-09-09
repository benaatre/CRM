import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * توثيق موافقة الموظف على إفصاح الخصوصية — تُسجَّل مرة في سجل التدقيق
 * (append-only) فتبقى الموافقة مؤرَّخة بهوية صاحبها وعنوانه.
 * v3 (الثقة المتجددة): النص صار يشمل النبض الجغرافي الدوري أثناء الدوام.
 */
export async function POST(req: Request) {
  const session = await requireUserApi();
  if (session instanceof Response) return NextResponse.json({ ok: false }, { status: 401 });

  await recordAuditEvent(prisma, {
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "PRIVACY_CONSENT",
    resourceType: "user",
    resourceId: session.user.id,
    after: { consent: "attendance_location_disclosure_v3" },
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  return NextResponse.json({ ok: true });
}
