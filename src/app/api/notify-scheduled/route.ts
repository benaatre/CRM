import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runFollowupDueCheck, runIdleEmployeeCheck } from "@/lib/notifications/scheduled";
import { runNoResponsePullback } from "@/lib/auto-distribute";
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
  // #38: نعزل الفشل ونبلّغ عنه (بدل ابتلاعه وإرجاع ok:true) ليلتقطه مراقب الكرون.
  const results = await Promise.allSettled([runFollowupDueCheck(), runIdleEmployeeCheck()]);
  const names = ["followupDue", "idle"] as const;
  const counts = { followupDue: 0, idle: 0 };
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") counts[names[i]] = r.value;
    else { failed.push(names[i]); console.error(`[notify-scheduled] ${names[i]}`, r.reason); }
  });

  // حوكمة «لم يتم الرد» — تنبيه ٤٨س + سحب ٧٢س (DRY_RUN افتراضيًا خلف NO_RESPONSE_PULL).
  const pullback = await runNoResponsePullback();
  if (!pullback.ok) { failed.push("noResponse"); console.error("[notify-scheduled] noResponse", pullback.error); }

  const touched = counts.followupDue > 0 || counts.idle > 0 || (pullback.ok && (pullback.warned > 0 || pullback.pulled > 0));
  if (touched) revalidatePath("/", "layout");
  return NextResponse.json(
    { ok: failed.length === 0, ...counts, noResponse: pullback, ...(failed.length ? { failed } : {}) },
    { status: failed.length ? 500 : 200 },
  );
}
