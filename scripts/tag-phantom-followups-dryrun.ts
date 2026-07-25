/**
 * scripts/tag-phantom-followups-dryrun.ts — «المتابعات الشبحية»: عرض ما سيُوسَم، بلا أي كتابة.
 *
 * ⛔ هذا السكربت **لا يكتب في القاعدة إطلاقًا**. لا يقبل --execute ولا أي علم تنفيذ.
 *    مهمته أن يعرض على المالك بالضبط أي صفوف ستُمسّ لو تقرّر التصحيح، ثم يقف.
 *
 * التعريف المعتمد لـ«الشبحية»: متابعة موجودة في كرت عميل، كاتبها ≠ الموظف المسند له
 * العميل الآن، وهي **مرئية** له (لم تُخفَ بقاعدة التوزيع «كعميل جديد» _fresh).
 * ملاحظة: هذه ليست متابعات من صنع النظام — كلها من فعل بشر، لكن من شخص آخر.
 *
 * الخيار المقترح (بلا حذف تاريخ أبدًا): وسم عرض فقط عبر AuditLog بنوع
 * `followup.priorOwner` — والواجهة تعرض الوسم من نسبة الكاتب مباشرة (مطبَّق فعلًا
 * في مسار GET /followups: byCurrentOwner) فلا حاجة لأي كتابة في الأغلب.
 *
 * التشغيل: npx tsx --env-file=.env scripts/tag-phantom-followups-dryrun.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const fmt = (d: Date) => new Intl.DateTimeFormat("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }).format(d);

async function main() {
  if (process.argv.slice(2).some((a) => /^--(execute|apply|write|force)$/.test(a))) {
    console.error("⛔ هذا السكربت للعرض فقط — ما فيه وضع تنفيذ. التصحيح يحتاج أمرًا صريحًا من المالك أولًا.");
    process.exitCode = 2;
    return;
  }

  const [users, leads, fus, reas] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, role: true } }),
    prisma.lead.findMany({ select: { id: true, name: true, assignedToId: true, assignedAt: true } }),
    prisma.followUp.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, leadId: true, createdBy: true, createdAt: true, result: true, note: true },
    }),
    prisma.reassignment.findMany({
      where: { toUserId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { leadId: true, reason: true },
    }),
  ]);
  const uById = new Map(users.map((u) => [u.id, u]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const lastReason = new Map<string, string>();
  for (const r of reas) if (!lastReason.has(r.leadId)) lastReason.set(r.leadId, r.reason);

  type Hit = { id: string; leadId: string; leadName: string; author: string; authorRole: string; owner: string; result: string; at: Date; reason: string };
  const visible: Hit[] = [];
  let hiddenByFresh = 0;

  for (const f of fus) {
    const l = leadById.get(f.leadId);
    if (!l?.assignedToId || l.assignedToId === f.createdBy) continue;
    const reason = lastReason.get(f.leadId) ?? "(بلا سجل إسناد)";
    // قاعدة الإخفاء القائمة: توزيع «كعميل جديد» (_fresh) يحجب ما قبل آخر إسناد عن الموظف.
    if (reason.endsWith("_fresh") && l.assignedAt && f.createdAt <= l.assignedAt) { hiddenByFresh++; continue; }
    const a = uById.get(f.createdBy);
    visible.push({
      id: f.id, leadId: l.id, leadName: l.name,
      author: a?.name ?? "؟", authorRole: a?.role ?? "؟",
      owner: uById.get(l.assignedToId)?.name ?? "؟",
      result: f.result, at: f.createdAt, reason,
    });
  }

  console.log("=".repeat(104));
  console.log("عرض جاف (DRY-RUN) — بلا أي كتابة في القاعدة");
  console.log("=".repeat(104));
  console.log(`إجمالي المتابعات: ${fus.length}`);
  console.log(`كاتبها ≠ مالك العميل الحالي: ${visible.length + hiddenByFresh}`);
  console.log(`  منها مخفية أصلًا بقاعدة «كعميل جديد» (_fresh): ${hiddenByFresh}`);
  console.log(`  ⚠️ مرئية للموظف الحالي — وهي المقصودة بالشكوى: ${visible.length}`);

  const byReason = new Map<string, number>();
  const byOwner = new Map<string, number>();
  const byResult = new Map<string, number>();
  let byManager = 0;
  for (const h of visible) {
    byReason.set(h.reason, (byReason.get(h.reason) ?? 0) + 1);
    byOwner.set(h.owner, (byOwner.get(h.owner) ?? 0) + 1);
    byResult.set(h.result, (byResult.get(h.result) ?? 0) + 1);
    if (h.authorRole !== "EMPLOYEE") byManager++;
  }
  const dump = (title: string, m: Map<string, number>) => {
    console.log(`\n${title}`);
    for (const [k, n] of [...m].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(30)} ${String(n).padStart(4)}`);
  };
  dump("حسب سبب آخر إسناد للعميل:", byReason);
  dump("حسب الموظف الذي يراها في كرته:", byOwner);
  dump("حسب نتيجة المتابعة:", byResult);
  console.log(`\nكتبها مالك/مدير (لا موظف): ${byManager}`);

  console.log("\n" + "-".repeat(104));
  console.log("الصفوف التي ستُمسّ لو تقرّر الوسم (أول ٣٠):");
  console.log("-".repeat(104));
  for (const h of visible.slice(0, 30)) {
    console.log(`  ${h.id} | ${h.leadName.slice(0, 16).padEnd(16)} | ${h.result.padEnd(24)} | كتبها ${h.author.padEnd(14)} | الآن عند ${h.owner.padEnd(14)} | ${fmt(h.at)}`);
  }
  if (visible.length > 30) console.log(`  … و${visible.length - 30} صفًّا آخر.`);

  console.log("\n" + "=".repeat(104));
  console.log("الخيارات المطروحة (كلها تحتاج أمرك — ما نُفّذ شيء):");
  console.log("  ١) بلا كتابة إطلاقًا (المقترح): الواجهة توسم الكاتب من نسبته مباشرة —");
  console.log("     مطبَّق فعلًا في GET /followups (byCurrentOwner) وسجل المتابعات.");
  console.log("  ٢) وسم دائم: سجل AuditLog `followup.priorOwner` لكل صف أعلاه — تاريخ محفوظ، بلا تعديل الصف.");
  console.log("  ٣) إخفاء بأثر رجعي: تحويل سبب الإسناد إلى _fresh لهؤلاء العملاء — ⚠️ يحجب سجلًا");
  console.log("     قد يحتاجه الموظف الحالي فعلًا (١٢٧ منهم بسبب manual_redistribute القديم قبل وجود الخيار).");
  console.log("\n⛔ توقّف. لا تنفيذ بلا قرار صريح.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
