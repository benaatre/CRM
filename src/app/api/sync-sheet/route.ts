import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runSheetSync } from "@/lib/sheet-sync";

export const runtime = "nodejs";

// نقطة لمزامنة جوجل شيت من cron (Hostinger). تُحمى بسرّ في متغيّر البيئة SYNC_SECRET.
// مثال cron: curl "https://your-domain.com/api/sync-sheet?secret=XXXX"
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.SYNC_SECRET || secret !== process.env.SYNC_SECRET) {
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
