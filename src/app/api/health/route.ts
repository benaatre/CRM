import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runDistributionPasses } from "@/lib/auto-distribute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// فحص صحة التطبيق + إعادة تشغيل ذاتي عند تعطّل القاعدة (للطلبات الموثّقة فقط)،
// ومع نجاح الفحص يشغّل دورة التوزيع (passان مستقلان خلف سويتشيهما).
// مثال cron:  */2 * * * *  curl -s -H "Authorization: Bearer YOUR_SECRET" https://crm.benaatre.com/api/health
export async function GET(req: Request) {
  const authorized = isCronAuthorized(req, process.env.CRON_SECRET);

  try {
    // فحص اتصال القاعدة
    await prisma.$queryRaw`SELECT 1`;
    // القاعدة سليمة — لو الطلب موثّق، شغّل دورة التوزيع (كل pass خلف سويتشه).
    let result: Awaited<ReturnType<typeof runDistributionPasses>> | null = null;
    if (authorized) {
      result = await runDistributionPasses();
      const moved = result.initialDistribute.count + result.reassignSweep.count;
      if (result.ok && moved > 0) {
        revalidatePath("/leads");
        revalidatePath("/pipeline");
        revalidatePath("/dashboard");
        revalidatePath("/distribution");
      }
    }
    // نُعيد حالة كل pass صراحة (on/count) — أيّهما اشتغل وكم حرّك.
    return NextResponse.json({
      ok: true,
      ts: new Date().toISOString(),
      initialDistribute: { on: result?.initialDistribute.on ?? false, count: result?.initialDistribute.count ?? 0 },
      reassignSweep: { on: result?.reassignSweep.on ?? false, count: result?.reassignSweep.count ?? 0 },
    });
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
