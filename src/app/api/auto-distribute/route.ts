import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runReassignSweep } from "@/lib/auto-distribute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// نقطة الفحص الدوري لإعادة توجيه العملاء المتأخرين — تُستدعى من cron (Hostinger hPanel).
// تُحمى بسرّ في متغيّر البيئة CRON_SECRET.
// مثال cron كل دقيقتين:
//   */2 * * * *  curl -s "https://your-domain.com/api/auto-distribute?secret=YOUR_SECRET"
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
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
