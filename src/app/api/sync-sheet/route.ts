import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runSheetSync } from "@/lib/sheet-sync";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

// نقطة لمزامنة جوجل شيت من cron (Hostinger). تُحمى بسرّ SYNC_SECRET (هيدر Bearer أو ?secret= مؤقتًا).
// مثال cron: curl -H "Authorization: Bearer XXXX" https://your-domain.com/api/sync-sheet
export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.SYNC_SECRET)) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const res = await runSheetSync();
  // عملاء جدد وصلوا → حدّث الجدول والكانبان واللوحة فورًا.
  if (res.ok && res.created && res.created > 0) {
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    revalidatePath("/admin");
  }
  return NextResponse.json(res);
}
