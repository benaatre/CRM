// حذف الـ48 عميل (Sheet0 قبل الإصلاح) + إعادة ضبط الرابط — تمهيدًا لإعادة السحب الصحيح.
import { readFileSync } from "node:fs";

async function main() {
  const env = readFileSync(".env.local", "utf8");
  const m = env.match(/^GOOGLE_SERVICE_ACCOUNT_KEY=(.*)$/m);
  if (m) process.env.GOOGLE_SERVICE_ACCOUNT_KEY = m[1].trim();

  const { readSheetValues } = await import("../src/lib/google-sheets");
  const { parseRowsByContent } = await import("../src/lib/utils/sheet-parse");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  // اقرأ أول 50 صف من Sheet0 (بالمعالج المصحّح) لتحديد هواتف الدفعة بدقّة.
  const values = await readSheetValues("1D8kx9THle1KDJVftcHWKfvrXPrKtUdDBVKCbpoGZbd0", { gid: 2066983452 });
  const { leads } = parseRowsByContent(values, { limit: 50 });
  const phones = [...new Set(leads.filter((l) => l.valid).map((l) => l.phone))];
  console.log("هواتف Sheet0 (أول 50، فريدة):", phones.length);

  const meta = await prisma.leadSource.findFirst({ where: { name: "ميتا" }, select: { id: true } });
  if (!meta) { console.log("لا مصدر ميتا"); await prisma.$disconnect(); return; }

  // احذف فقط عملاء ميتا اللي هواتفهم من دفعة Sheet0 (لا تلمس عملاء تبويب سعود حامد).
  const del = await prisma.lead.deleteMany({ where: { sourceId: meta.id, phone: { in: phones }, assignedToId: null } });
  console.log("حُذف من القاعدة:", del.count);

  // أعد ضبط رابط Sheet0 ليعيد القراءة من البداية.
  const link = await prisma.sheetLink.findFirst({ where: { sheetUrl: { contains: "gid=2066983452" } }, select: { id: true } });
  if (link) {
    await prisma.sheetLink.update({ where: { id: link.id }, data: { lastRowSynced: 0, lastSyncStatus: null, lastSyncError: null } });
    console.log("أُعيد ضبط الرابط lastRowSynced=0");
  } else {
    console.log("⚠️ ما لقيت رابط Sheet0");
  }

  const remain = await prisma.lead.count({ where: { sourceId: meta.id } });
  console.log("عملاء ميتا المتبقّون (المفروض ~10 من سعود حامد):", remain);
  await prisma.$disconnect();
}
main();
