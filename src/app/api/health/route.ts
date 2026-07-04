import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// فحص صحة التطبيق + إعادة تشغيل ذاتي عند تعطّل القاعدة (للطلبات الموثّقة فقط).
// مثال cron:  */5 * * * *  curl -s -H "Authorization: Bearer YOUR_SECRET" https://crm.benaatre.com/api/health
export async function GET(req: Request) {
  const authorized = isCronAuthorized(req, process.env.CRON_SECRET);

  try {
    // فحص اتصال القاعدة
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, ts: new Date().toISOString() });
  } catch {
    // القاعدة/التطبيق فيه مشكلة — لو الطلب موثّق، أعد التشغيل عبر لمس restart.txt.
    if (authorized) {
      try {
        const tmpDir = join(process.cwd(), "tmp");
        mkdirSync(tmpDir, { recursive: true });
        writeFileSync(join(tmpDir, "restart.txt"), new Date().toISOString());
      } catch {}
    }
    return NextResponse.json({ ok: false, restarted: authorized }, { status: 503 });
  }
}
