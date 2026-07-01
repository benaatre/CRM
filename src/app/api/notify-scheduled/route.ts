import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runFollowupDueCheck, runIdleEmployeeCheck } from "@/lib/notifications/scheduled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// تنبيهات زمنية: «قرب موعد متابعة» + «موظف ركد». تُستدعى من cron (Hostinger hPanel).
// محمي بسرّ CRON_SECRET. مثال (كل ١٥ دقيقة):
//   */15 * * * *  curl -s "https://crm.benaatre.com/api/notify-scheduled?secret=YOUR_SECRET"
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const [followupDue, idle] = await Promise.all([
    runFollowupDueCheck().catch(() => 0),
    runIdleEmployeeCheck().catch(() => 0),
  ]);
  if (followupDue > 0 || idle > 0) revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, followupDue, idle });
}
