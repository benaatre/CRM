import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runFollowupDueCheck, runIdleEmployeeCheck } from "@/lib/notifications/scheduled";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// تنبيهات زمنية: «قرب موعد متابعة» + «موظف ركد». تُستدعى من cron (Hostinger hPanel).
// محمي بسرّ CRON_SECRET (هيدر Authorization: Bearer أو ?secret= مؤقتًا). مثال (كل ١٥ دقيقة):
//   */15 * * * *  curl -s -H "Authorization: Bearer YOUR_SECRET" https://crm.benaatre.com/api/notify-scheduled
export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const [followupDue, idle] = await Promise.all([
    runFollowupDueCheck().catch(() => 0),
    runIdleEmployeeCheck().catch(() => 0),
  ]);
  if (followupDue > 0 || idle > 0) revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, followupDue, idle });
}
