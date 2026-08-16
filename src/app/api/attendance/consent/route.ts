import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * توثيق موافقة الموظف على إفصاح الخصوصية (الدفعة الرابعة) — تُسجَّل مرة في
 * سجل التدقيق (append-only) فتبقى الموافقة مؤرَّخة بهوية صاحبها وعنوانه.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  await recordAuditEvent(prisma, {
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "PRIVACY_CONSENT",
    resourceType: "user",
    resourceId: session.user.id,
    after: { consent: "attendance_location_disclosure_v2" },
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  return NextResponse.json({ ok: true });
}
