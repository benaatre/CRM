import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runDistributionPasses } from "@/lib/auto-distribute";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// نقطة الفحص الدوري لدورة التوزيع (توزيع أولي + سحب متأخرين، كل pass خلف سويتشه) — cron.
// تُحمى بسرّ CRON_SECRET عبر هيدر Authorization: Bearer (أو ?secret= مؤقتًا).
// مثال cron كل دقيقتين:
//   */2 * * * *  curl -s -H "Authorization: Bearer YOUR_SECRET" https://crm.benaatre.com/api/auto-distribute
export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const res = await runDistributionPasses();
  // توزيع أولي أو سحب حصل → حدّث الجداول واللوحات فورًا.
  const moved = res.initialDistribute.count + res.reassignSweep.count;
  if (res.ok && moved > 0) {
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    revalidatePath("/distribution");
  }
  return NextResponse.json(res);
}
