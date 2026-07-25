import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getNoResponseConfig, parsePullEnabled } from "@/lib/no-response-escalation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// فحص بيئة مؤقت (تشخيص حادثة NO_RESPONSE_PULL=true التي بقيت «معاينة») — محمي بسرّ
// الكرون بنفس نمط health. يحسم: هل المتغيران يصلان التطبيق وقت التشغيل أم لا،
// ووش نتيجة التفسير المحصّن وما يراه getNoResponseConfig فعليًا.
export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const config = getNoResponseConfig();
  return NextResponse.json({
    pullRaw: process.env.NO_RESPONSE_PULL ?? null,
    activationRaw: process.env.NO_RESPONSE_ACTIVATION_DATE ?? null,
    pullParsed: parsePullEnabled(process.env.NO_RESPONSE_PULL),
    configActive: config.enabled,
    activationParsed: config.activationDate?.toISOString() ?? null,
  });
}
