import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runDistributionPasses } from "@/lib/auto-distribute";
import { syncAllSheetLinks, type SheetSyncResult } from "@/lib/sheet-sync-google";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// حد الصفوف المعالجة لكل رابط شيت في الدورة الواحدة (الكرون كل دقيقتين — يلحق الذيل بسرعة).
const SHEET_ROWS_PER_CYCLE = 50;

// نقطة الفحص الدوري لدورة التوزيع (توزيع أولي + سحب متأخرين، كل pass خلف سويتشه) — cron.
// مزامنة الشيتات مدموجة في أول الدورة نفسها (لا كرون ثالث): الصف الجديد يصير عميلًا غير موزّع
// ثم يلتقطه pass التوزيع في نفس الدورة — أسرع وصول للموظف، وفشل المزامنة معزول لا يوقف التوزيع.
// /api/sync-sheets تبقى نقطة مستقلة للاختبار اليدوي أو لكرون مخصص لاحقًا.
// تُحمى بسرّ CRON_SECRET عبر هيدر Authorization: Bearer (أو ?secret= مؤقتًا).
// مثال cron كل دقيقتين:
//   */2 * * * *  curl -s -H "Authorization: Bearer YOUR_SECRET" https://crm.benaatre.com/api/auto-distribute
export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }

  // ١) مزامنة الشيتات أولًا — معزولة بالكامل (خطأها يُبلَّغ ولا يوقف التوزيع).
  let sheets: { ok: boolean; totalCreated: number; results: SheetSyncResult[] } = { ok: true, totalCreated: 0, results: [] };
  try {
    sheets = await syncAllSheetLinks({ limit: SHEET_ROWS_PER_CYCLE });
  } catch (e) {
    sheets = { ok: false, totalCreated: 0, results: [] };
    console.error("[auto-distribute] sheetSync", e);
  }

  // ٢) دورة التوزيع — تلتقط عملاء الشيت الجدد (غير الموزّعين) في نفس الدورة.
  const res = await runDistributionPasses();
  // توزيع أولي أو سحب أو عملاء شيت جدد → حدّث الجداول واللوحات فورًا.
  const moved = res.initialDistribute.count + res.reassignSweep.count + sheets.totalCreated;
  if (moved > 0) {
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    revalidatePath("/distribution");
  }
  return NextResponse.json({ ...res, sheets });
}
