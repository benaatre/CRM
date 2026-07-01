import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { syncAllSheetLinks } from "@/lib/sheet-sync-google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// مزامنة جوجل شيت عبر Sheets API — تُستدعى من cron (cron-job.org) بسرّ CRON_SECRET.
// ينشئ عملاء غير موزّعين بمصدر كل رابط (يدخلون دورة التوزيع عبر /api/auto-distribute).
// مثال (كل دقيقة):  * * * * *  curl -s "https://crm.benaatre.com/api/sync-sheets?secret=YOUR_SECRET"
// limit اختياري: يحدّ عدد الصفوف لكل رابط هذه الجولة (للسحب على دفعات/الاختبار).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;

  const res = await syncAllSheetLinks(limit != null ? { limit } : undefined);
  if (res.totalCreated > 0) {
    revalidatePath("/leads");
    revalidatePath("/distribution");
    revalidatePath("/dashboard");
  }
  return NextResponse.json(res);
}
