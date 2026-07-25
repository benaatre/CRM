/**
 * scripts/diagnose-phantom-followups.ts — تشخيص (قراءة فقط) لـ«المتابعات الشبحية»:
 * متابعات يجدها الموظف في كرت العميل ويقول ما سجّلها.
 *
 * يفحص كل الاحتمالات بالأرقام:
 *  أ) متابعات كاتبها ليس مالك العميل وقت التسجيل (تاريخ مالك سابق ظهر بعد إعادة التوزيع «بمحتواه»).
 *  ب) متابعات كتبها مالك/مدير على عميل موظف.
 *  ج) متابعات واتساب التلقائية (زر «إرسال واتساب» يسجّل متابعة بلا نموذج).
 *  د) بقايا متابعات CALL المصطنعة القديمة.
 *  هـ) متابعات بلا نشاط/سجل تدقيق مصاحب (أثر كتابة آلية).
 *
 * التشغيل: npx tsx --env-file=.env scripts/diagnose-phantom-followups.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const RESULTS_COMPLAINED = ["FOLLOW_UP_SCHEDULED", "ON_HOLD"] as const;
const fmt = (d: Date) => new Intl.DateTimeFormat("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }).format(d);

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true } });
  const uById = new Map(users.map((u) => [u.id, u]));
  const total = await prisma.followUp.count();
  console.log(`إجمالي المتابعات في القاعدة: ${total}\n`);

  // توزيع النتائج
  const byResult = await prisma.followUp.groupBy({ by: ["result"], _count: { _all: true } });
  console.log("توزيع النتائج:");
  for (const r of [...byResult].sort((a, b) => b._count._all - a._count._all)) {
    console.log(`   ${r.result.padEnd(30)} ${String(r._count._all).padStart(6)}`);
  }

  // ===== ج) متابعات الواتساب التلقائية =====
  const waAuto = await prisma.followUp.count({ where: { type: "WHATSAPP", result: "NOT_ANSWERED_WHATSAPP", note: "أُرسل واتساب" } });
  console.log(`\nج) متابعات «أُرسل واتساب» التلقائية (تُكتب بمجرد ضغط زر الواتساب): ${waAuto}`);

  // ===== د) بقايا متابعات CALL المصطنعة =====
  const synthetic = await prisma.followUp.findMany({
    where: { type: "CALL", OR: [{ note: null }, { note: "" }, { note: { in: ["اتصال", "مكالمة", "تم الاتصال"] } }] },
    select: { id: true, result: true, note: true, createdAt: true, createdBy: true },
    take: 2000,
  });
  console.log(`د) متابعات CALL بلا ملاحظة (نمط المصطنعة القديمة): ${synthetic.length}`);
  if (synthetic.length) {
    const g = new Map<string, number>();
    for (const s of synthetic) g.set(s.result, (g.get(s.result) ?? 0) + 1);
    for (const [r, n] of [...g].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`     ${r.padEnd(28)} ${n}`);
    const dates = synthetic.map((s) => s.createdAt.getTime());
    console.log(`     المدى الزمني: ${fmt(new Date(Math.min(...dates)))} → ${fmt(new Date(Math.max(...dates)))}`);
  }

  // ===== أ) + ب) الكاتب مقابل المالك =====
  // نأخذ متابعات النتيجتين المشكو منهما ونفحص من كتبها ومن كان يملك العميل وقتها.
  const suspects = await prisma.followUp.findMany({
    where: { result: { in: [...RESULTS_COMPLAINED] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, leadId: true, createdBy: true, createdAt: true, result: true, note: true, type: true },
  });
  console.log(`\nمتابعات «موعد لاحق» + «في الانتظار» إجمالًا: ${suspects.length}`);

  const leadIds = [...new Set(suspects.map((s) => s.leadId))];
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, name: true, assignedToId: true, assignedAt: true },
  });
  const leadById = new Map(leads.map((l) => [l.id, l]));
  // كل إعادات الإسناد لهؤلاء العملاء — لمعرفة المالك وقت كتابة كل متابعة.
  const reas = await prisma.reassignment.findMany({
    where: { leadId: { in: leadIds } },
    orderBy: { createdAt: "asc" },
    select: { leadId: true, toUserId: true, createdAt: true, reason: true },
  });
  const reasByLead = new Map<string, typeof reas>();
  for (const r of reas) { const a = reasByLead.get(r.leadId); if (a) a.push(r); else reasByLead.set(r.leadId, [r]); }
  /** مالك العميل وقت لحظة معيّنة (من آخر إسناد قبلها). */
  function ownerAt(leadId: string, at: Date): string | null {
    const list = reasByLead.get(leadId) ?? [];
    let owner: string | null = null;
    for (const r of list) { if (r.createdAt <= at) owner = r.toUserId; else break; }
    return owner;
  }

  let byManager = 0, byFormerOwner = 0, byCurrentOwner = 0, unknownOwner = 0;
  const nowOrphan: { leadName: string; author: string; current: string; result: string; at: Date; reason: string }[] = [];
  for (const s of suspects) {
    const l = leadById.get(s.leadId)!;
    const author = uById.get(s.createdBy);
    const at = ownerAt(s.leadId, s.createdAt);
    if (author && author.role !== "EMPLOYEE") byManager++;
    else if (at == null) unknownOwner++;
    else if (at === s.createdBy) byCurrentOwner++;
    else byFormerOwner++;
    // ما يراه الموظف الحالي: متابعة في كرته كتبها شخص آخر
    if (l.assignedToId && l.assignedToId !== s.createdBy) {
      const last = [...(reasByLead.get(s.leadId) ?? [])].reverse().find((r) => r.toUserId === l.assignedToId);
      nowOrphan.push({
        leadName: l.name, author: author?.name ?? "؟", current: uById.get(l.assignedToId)?.name ?? "؟",
        result: s.result, at: s.createdAt, reason: last?.reason ?? "—",
      });
    }
  }
  console.log(`   كتبها مالك/مدير (لا موظف): ${byManager}`);
  console.log(`   كتبها مالك العميل وقتها (سليمة): ${byCurrentOwner}`);
  console.log(`   كتبها موظف لم يكن يملك العميل وقتها: ${byFormerOwner}`);
  console.log(`   بلا سجل إسناد يحدّد المالك وقتها: ${unknownOwner}`);
  console.log(`\n⚠️ الشبحية الفعلية (متابعة في كرت عميل كاتبها ≠ مالكه الحالي): ${nowOrphan.length}`);
  const bySuffix = new Map<string, number>();
  for (const o of nowOrphan) bySuffix.set(o.reason, (bySuffix.get(o.reason) ?? 0) + 1);
  for (const [r, n] of [...bySuffix].sort((a, b) => b[1] - a[1])) console.log(`     سبب آخر إسناد «${r}»: ${n}`);
  console.log("\n   عيّنة (آخر ١٢):");
  for (const o of nowOrphan.slice(0, 12)) {
    console.log(`     ${o.leadName.slice(0, 20).padEnd(20)} | ${o.result.padEnd(20)} | كتبها: ${o.author.padEnd(14)} | الآن عند: ${o.current.padEnd(14)} | ${fmt(o.at)}`);
  }

  // ===== نفس الفحص لكل المتابعات (لا النتيجتين فقط) =====
  const allFus = await prisma.followUp.findMany({ select: { leadId: true, createdBy: true, result: true } });
  const allLeads = await prisma.lead.findMany({ select: { id: true, assignedToId: true } });
  const ownerNow = new Map(allLeads.map((l) => [l.id, l.assignedToId]));
  let orphanAll = 0;
  const orphanByResult = new Map<string, number>();
  for (const f of allFus) {
    const cur = ownerNow.get(f.leadId);
    if (cur && cur !== f.createdBy) { orphanAll++; orphanByResult.set(f.result, (orphanByResult.get(f.result) ?? 0) + 1); }
  }
  console.log(`\nعلى مستوى القاعدة كلها: ${orphanAll} متابعة من أصل ${allFus.length} كاتبها ≠ مالك العميل الحالي (${Math.round((orphanAll / allFus.length) * 100)}%)`);
  for (const [r, n] of [...orphanByResult].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`     ${r.padEnd(28)} ${n}`);

  // ===== هـ) تنزيلات «مهتم راكد» التلقائية =====
  const autoDemote = await prisma.auditLog.count({ where: { action: "lead.autoDemoted" } });
  const autoAct = await prisma.activity.count({ where: { type: "STAGE_CHANGE", note: { contains: "تنزيل تلقائي" } } });
  const autoActNoUser = await prisma.activity.count({ where: { type: "STAGE_CHANGE", note: { contains: "تنزيل تلقائي" }, userId: null } });
  console.log(`\nهـ) التنزيل التلقائي (مهتم راكد ١٤ يومًا ← «موعد لاحق»):`);
  console.log(`     سجلات تدقيق lead.autoDemoted: ${autoDemote}`);
  console.log(`     أنشطة «تنزيل تلقائي»: ${autoAct} — منها بلا مستخدم (تظهر بلا اسم): ${autoActNoUser}`);
  console.log(`     متابعات أنشأها هذا المسار: 0 (المسار يغيّر المرحلة فقط)`);

  // عملاء «موعد لاحق» بموعد متابعة ولا متابعة تشرحه
  const flAuto = await prisma.lead.count({
    where: { stage: "FOLLOW_UP_LATER", nextFollowup: { not: null }, followUps: { none: { result: "FOLLOW_UP_SCHEDULED" } } },
  });
  console.log(`     عملاء بمرحلة «موعد لاحق» + موعد متابعة بلا أي متابعة «موعد لاحق» تشرحه: ${flAuto}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
