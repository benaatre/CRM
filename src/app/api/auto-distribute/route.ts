import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runReassignSweep } from "@/lib/auto-distribute";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// نقطة الفحص الدوري لإعادة توجيه العملاء المتأخرين — تُستدعى من cron (Hostinger hPanel).
// تُحمى بسرّ CRON_SECRET عبر هيدر Authorization: Bearer (أو ?secret= مؤقتًا).
// مثال cron كل دقيقتين:
//   */2 * * * *  curl -s -H "Authorization: Bearer YOUR_SECRET" https://crm.benaatre.com/api/auto-distribute
export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const res = await runReassignSweep();
  // توزيع أولي أو إعادة توجيه حصل → حدّث الجداول واللوحات فورًا.
  if (res.ok && (res.reassigned > 0 || (res.distributed ?? 0) > 0)) {
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    revalidatePath("/distribution");
  }
  return NextResponse.json(res);
}
