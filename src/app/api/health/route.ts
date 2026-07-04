import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runReassignSweep } from "@/lib/auto-distribute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// فحص صحة التطبيق + إعادة تشغيل ذاتي عند تعطّل القاعدة (للطلبات الموثّقة فقط)،
// ومع نجاح الفحص يشغّل التوزيع التلقائي (نفس دالة /api/auto-distribute — بلا تكرار منطق).
// مثال cron:  */2 * * * *  curl -s -H "Authorization: Bearer YOUR_SECRET" https://crm.benaatre.com/api/health
export async function GET(req: Request) {
  const authorized = isCronAuthorized(req, process.env.CRON_SECRET);

  try {
    // فحص اتصال القاعدة
    await prisma.$queryRaw`SELECT 1`;
    // القاعدة سليمة — لو الطلب موثّق، شغّل التوزيع (نفس منطق auto-distribute).
    let sweep: Awaited<ReturnType<typeof runReassignSweep>> | { error: string } | null = null;
    if (authorized) {
      try {
        sweep = await runReassignSweep();
        // توزيع أولي أو إعادة توجيه حصل → حدّث الجداول واللوحات فورًا (مطابق لـ auto-distribute).
        if (sweep.ok && (sweep.reassigned > 0 || (sweep.distributed ?? 0) > 0)) {
          revalidatePath("/leads");
          revalidatePath("/pipeline");
          revalidatePath("/dashboard");
          revalidatePath("/distribution");
        }
      } catch {
        sweep = { error: "sweep failed" };
      }
    }
    return NextResponse.json({ ok: true, ts: new Date().toISOString(), sweep });
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
