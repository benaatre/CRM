/**
 * scripts/restore-to-1pm.ts — استرجاع بنقطة زمنية: إرجاع العملاء لحالة الساعة ١:٠٠ ظهرًا (10:00Z).
 *
 * المبدأ: لكل ليد له سجل Reassignment بعد 10:00Z، مالك الساعة ١ = fromUserId في **أول** سجل
 * له بعد 10:00Z (بغض النظر عن reason). من كان مزاحًا عن هذا المالك الآن → يُعاد إليه.
 *
 * أمان:
 *  - dry-run افتراضي — لا كتابة إلا مع --execute.
 *  - يستثني reason="initial" (عميل جديد بعد الساعة ١، fromUserId=null) → قائمة منفصلة.
 *  - يستثني RESERVED/CLOSED_WON → قائمة منفصلة.
 *  - تحقّق مزدوج مقابل لقطة التراجع (مع ملاحظة: اللقطة تحمل حالة ما قبل استرجاعنا، لا مالك الساعة ١).
 *  - reassignCount لا يُصفَّر (تصفيره سابقًا أعاد العملاء مؤهّلين للسحب).
 *  - manualAssignedAt: غير موجود على Lead حاليًا → تنبيه فقط، لا يُضاف.
 *  - contactedAt · المرحلة · المتابعات: لا تتغيّر.
 *
 * تشغيل:
 *   npx tsx --env-file=.env scripts/restore-to-1pm.ts             # dry-run
 *   npx tsx --env-file=.env scripts/restore-to-1pm.ts --execute   # تنفيذ فعلي
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();
const SINCE = new Date("2026-07-19T10:00:00.000Z"); // 1:00 مساءً KSA
const EXECUTE = process.argv.includes("--execute");
const MARK = "restore_to_1pm";
const SNAP_PATH = join(process.cwd(), "scripts", "out", "rollback-2026-07-19T11-58-42-066Z.json");
const HAS_MANUAL_ASSIGNED_AT = false; // الحقل غير موجود على Lead (تُحدَّث لو أُضيف لاحقًا)

function ksa(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
}

async function main() {
  const now = new Date();
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const nm = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? ("?" + id.slice(-6)) : "—");

  console.log("=".repeat(98));
  console.log(`استرجاع لحالة الساعة ١:٠٠ (${ksa(SINCE)} KSA) — ${EXECUTE ? "🔴 تنفيذ فعلي" : "🟢 dry-run"}  |  الآن ${ksa(now)}`);
  console.log("=".repeat(98));

  // (١) كل سجلات Reassignment بعد 10:00Z، تصاعديًا → أول سجل لكل ليد.
  const reas = await prisma.reassignment.findMany({
    where: { createdAt: { gte: SINCE } }, orderBy: { createdAt: "asc" },
    select: { leadId: true, fromUserId: true, toUserId: true, reason: true, createdAt: true },
  });
  const first = new Map<string, (typeof reas)[number]>();
  for (const r of reas) if (!first.has(r.leadId)) first.set(r.leadId, r);

  const leadIds = [...first.keys()];
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, name: true, stage: true, assignedToId: true },
  });
  const lById = new Map(leads.map((l) => [l.id, l]));

  // (٢) لقطة التراجع القديمة (للتحقّق المزدوج).
  let snapById = new Map<string, string | null>();
  try {
    const snap = JSON.parse(readFileSync(SNAP_PATH, "utf8"));
    snapById = new Map(snap.leads.map((l: { leadId: string; assignedToId: string | null }) => [l.leadId, l.assignedToId]));
  } catch (e) {
    console.log(`⚠️  تعذّر قراءة لقطة التراجع (${(e as Error).message}) — التحقّق المزدوج لن يعمل.`);
  }

  // (٣) تصنيف كل ليد.
  const initialExcluded: { id: string; name: string }[] = [];
  const blockedExcluded: { id: string; name: string; stage: string }[] = [];
  const plan: { leadId: string; name: string; owner1pm: string; current: string | null }[] = [];
  const alreadyOk: { id: string; name: string; owner: string }[] = [];
  // تحقّق مزدوج (حرفي: مالك الساعة١ مقابل assignedToId باللقطة).
  const snapLiteralConflict: { id: string; name: string; owner1pm: string; snap: string | null }[] = [];
  // تحقّق سلامة السلسلة (assignedToId باللقطة مقابل toUserId لأول سجل = وجهة كرون#١).
  const chainConflict: { id: string; name: string; snap: string | null; firstTo: string | null }[] = [];

  for (const leadId of leadIds) {
    const f = first.get(leadId)!;
    const lead = lById.get(leadId);
    if (!lead) continue;

    // استثناء: أول سجل initial (عميل جديد) أو بلا مالك أصلي.
    if (f.reason === "initial" || !f.fromUserId) { initialExcluded.push({ id: leadId, name: lead.name }); continue; }
    // استثناء: محجوز/مباع.
    if (lead.stage === "RESERVED" || lead.stage === "CLOSED_WON") { blockedExcluded.push({ id: leadId, name: lead.name, stage: lead.stage }); continue; }

    const owner1pm = f.fromUserId;

    // تحقّق مزدوج مع اللقطة (حرفي كما طُلب) + تحقّق سلامة السلسلة.
    if (snapById.has(leadId)) {
      const snapVal = snapById.get(leadId) ?? null;
      if (snapVal !== owner1pm) snapLiteralConflict.push({ id: leadId, name: lead.name, owner1pm, snap: snapVal });
      if (snapVal !== f.toUserId) chainConflict.push({ id: leadId, name: lead.name, snap: snapVal, firstTo: f.toUserId });
    }

    if (lead.assignedToId === owner1pm) { alreadyOk.push({ id: leadId, name: lead.name, owner: owner1pm }); continue; }
    plan.push({ leadId, name: lead.name, owner1pm, current: lead.assignedToId });
  }

  // عدد المتابعات لكل عميل مُزاح (لعرض «التاريخ محفوظ») + الإجمالي قبل التنفيذ.
  const planIds = plan.map((p) => p.leadId);
  const fuGrouped = await prisma.followUp.groupBy({ by: ["leadId"], where: { leadId: { in: planIds } }, _count: { _all: true } });
  const fuByLead = new Map(fuGrouped.map((g) => [g.leadId, g._count._all]));
  const fuTotalBefore = planIds.reduce((s, id) => s + (fuByLead.get(id) ?? 0), 0);

  // ===== التقرير =====
  console.log(`\nسجلات Reassignment بعد 10:00Z: ${reas.length}  |  ليدات فريدة: ${leadIds.length}`);
  console.log(`مؤهّلون لاسترجاع الساعة ١: ${plan.length + alreadyOk.length}  →  مُزاحون (يحتاجون إرجاع): ${plan.length} · عند مالك الساعة ١ أصلًا: ${alreadyOk.length}`);

  console.log(`\n▸ التوزيع المطلوب إرجاعه (المُزاحون فقط، ${plan.length}) حسب مالك الساعة ١:`);
  const dist = new Map<string, number>();
  for (const p of plan) dist.set(p.owner1pm, (dist.get(p.owner1pm) ?? 0) + 1);
  for (const [uid, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${nm(uid).padEnd(16)} : ${n}`);

  console.log(`\n▸ جدول المُزاحين (من الآن → مالك الساعة ١) — عمود «متابعات» يُثبت أن التاريخ محفوظ:`);
  console.log(`     ${"العميل".padEnd(24)} | متابعات | ${"من الآن".padEnd(16)} → مالك الساعة ١`);
  for (const p of plan) {
    console.log(`     ${p.name.slice(0, 24).padEnd(24)} | ${String(fuByLead.get(p.leadId) ?? 0).padStart(6)}  | ${(nm(p.current) ?? "—").slice(0, 16).padEnd(16)} → ${nm(p.owner1pm)}`);
  }
  console.log(`     ${"—".repeat(24)}   ${"—".repeat(7)}`);
  console.log(`     إجمالي متابعات الـ${plan.length} المتأثرين (قبل التنفيذ): ${fuTotalBefore}  ← لازم يبقى نفسه بعد التنفيذ`);

  console.log(`\n▸ مستثنون — reason="initial" (عملاء جدد بعد الساعة ١، لا تُلمس): ${initialExcluded.length}`);
  for (const x of initialExcluded) console.log(`     - ${x.name} [${x.id}]`);

  console.log(`\n▸ مستثنون — محجوز/مباع (لا تُلمس): ${blockedExcluded.length}`);
  for (const x of blockedExcluded) console.log(`     - ${x.name} (${x.stage}) [${x.id}]`);

  console.log(`\n▸ عند مالك الساعة ١ أصلًا (لا حاجة لإرجاع): ${alreadyOk.length}`);

  // التحقّق المزدوج — بصدق.
  console.log("\n" + "-".repeat(98));
  console.log("التحقّق المزدوج مع لقطة التراجع:");
  console.log(`  • مقارنة حرفية (مالك الساعة١ = assignedToId باللقطة): ${snapLiteralConflict.length} اختلاف من ${leadIds.length}`);
  console.log(`    ⚠️  متوقّع أن يكون الاختلاف شبه كلّي: اللقطة تحمل حالة ما قبل استرجاعنا (عبير)، لا مالك الساعة ١.`);
  console.log(`    لذلك هذه المقارنة الحرفية غير صالحة كمصدر ثانٍ، ولا أستثني بناءً عليها.`);
  console.log(`  • تحقّق سلامة السلسلة (assignedToId باللقطة = وجهة أول سجل toUserId): ${chainConflict.length} اختلاف`);
  if (chainConflict.length === 0) {
    console.log(`    ✅ اللقطة متّسقة تمامًا مع سجلات Reassignment — يؤكّد أن مصدر «مالك الساعة ١» (fromUserId) موثوق.`);
  } else {
    console.log(`    ❌ عدم اتساق — راجع يدويًا:`);
    for (const c of chainConflict) console.log(`       - ${c.name}: لقطة=${nm(c.snap)} ، وجهة أول سجل=${nm(c.firstTo)} [${c.id}]`);
  }

  if (!HAS_MANUAL_ASSIGNED_AT) {
    console.log(`\n⚠️  تنبيه: الحقل manualAssignedAt غير موجود على Lead — لن يُضبط (لن أضيفه الآن، حسب التعليمات).`);
  }

  // ===== التنفيذ =====
  if (!EXECUTE) {
    console.log("\n" + "=".repeat(98));
    console.log(`🟢 dry-run — لم تُكتب أي بيانات. سيُعاد ${plan.length} عميل عند --execute.`);
    return;
  }

  if (plan.length === 0) { console.log("\nما فيه عملاء مُزاحون للإرجاع."); return; }

  // ===== بوابة إلزامية: autoDistribute لازم false قبل أي كتابة =====
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { autoDistribute: true } });
  const autoOn = settings?.autoDistribute ?? null;
  console.log(`\n🚪 بوابة القاعدة: settings.autoDistribute = ${autoOn}`);
  if (autoOn !== false) {
    console.log("⛔ autoDistribute ليست false — إيقاف فوري، لا كتابة. أبلغ المالك.");
    return;
  }
  console.log("✅ autoDistribute = false — الكرون sweep لا يعمل (no-op). أكمل التنفيذ.");

  // خط أساس الـ29 غير المُزاحين (ما نلمسهم) — للتحقق أنهم لم يتغيّروا.
  const untouchedIds = alreadyOk.map((a) => a.id);
  const untouchedBefore = await prisma.lead.findMany({ where: { id: { in: untouchedIds } }, select: { id: true, assignedToId: true, assignedAt: true } });
  const untouchedKey = (l: { assignedToId: string | null; assignedAt: Date | null }) => `${l.assignedToId}|${l.assignedAt?.toISOString() ?? "null"}`;
  const untouchedBaseline = new Map(untouchedBefore.map((l) => [l.id, untouchedKey(l)]));

  // (أ) لقطة تراجع لهذه العملية قبل الكتابة.
  const snapNow = await prisma.lead.findMany({
    where: { id: { in: plan.map((p) => p.leadId) } },
    select: { id: true, assignedToId: true, assignedAt: true, reassignCount: true, contactedAt: true, stage: true },
  });
  const outDir = join(process.cwd(), "scripts", "out");
  mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `restore-1pm-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({
    createdAt: now.toISOString(), note: "لقطة قبل الاسترجاع لحالة الساعة ١", target: "10:00Z", count: snapNow.length,
    leads: snapNow.map((l) => ({ leadId: l.id, assignedToId: l.assignedToId, assignedAt: l.assignedAt?.toISOString() ?? null, reassignCount: l.reassignCount, contactedAt: l.contactedAt?.toISOString() ?? null, stage: l.stage })),
  }, null, 2), "utf8");
  console.log(`\n💾 لقطة التراجع: ${outPath}  |  عدد السجلات: ${snapNow.length} (لازم ${plan.length})`);
  if (snapNow.length !== plan.length) throw new Error("عدد اللقطة ≠ عدد الخطة — إيقاف.");

  const fuBefore = await prisma.followUp.count({ where: { leadId: { in: plan.map((p) => p.leadId) } } });

  // (ب) transaction واحدة.
  console.log(`\n🔴 إرجاع ${plan.length} عميل لحالة الساعة ١ في transaction واحدة…`);
  const updated = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const p of plan) {
      await tx.lead.update({
        where: { id: p.leadId },
        // reassignCount لا يُصفَّر. contactedAt/المرحلة/المتابعات لا تُلمس.
        data: { assignedToId: p.owner1pm, assignedAt: now },
      });
      await tx.reassignment.create({ data: { leadId: p.leadId, fromUserId: p.current, toUserId: p.owner1pm, reason: MARK } });
      n++;
    }
    return n;
  }, { maxWait: 20_000, timeout: 120_000 });

  console.log(`\n✅ transaction نجحت كوحدة واحدة. المحدَّثون: ${updated} (لازم ${plan.length}).`);

  // (ج) تحقّقات ما بعد.
  const after = await prisma.lead.findMany({ where: { id: { in: plan.map((p) => p.leadId) } }, select: { id: true, assignedToId: true } });
  const okCount = after.filter((l) => l.assignedToId === plan.find((p) => p.leadId === l.id)!.owner1pm).length;
  console.log(`  • عند مالك الساعة ١ الآن: ${okCount}/${plan.length}`);

  // التوزيع من القاعدة (الـ40 المحدَّثون).
  const distByOwner = new Map<string, number>();
  for (const l of after) distByOwner.set(l.assignedToId ?? "—", (distByOwner.get(l.assignedToId ?? "—") ?? 0) + 1);
  console.log(`  • التوزيع من القاعدة (${plan.length}):`);
  for (const [uid, n] of [...distByOwner.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${nm(uid).padEnd(16)} : ${n}`);

  // تأكيد الـ29 غير المُزاحين لم يُلمسوا (assignedToId + assignedAt كما هي).
  const untouchedAfter = await prisma.lead.findMany({ where: { id: { in: untouchedIds } }, select: { id: true, assignedToId: true, assignedAt: true } });
  const changed29 = untouchedAfter.filter((l) => untouchedBaseline.get(l.id) !== untouchedKey(l));
  console.log(`  • الـ${untouchedIds.length} غير المُزاحين: تغيّر منهم ${changed29.length} ${changed29.length === 0 ? "✅ لم يُلمسوا" : "❌ تغيّروا!"}`);

  const fuAfter = await prisma.followUp.count({ where: { leadId: { in: plan.map((p) => p.leadId) } } });
  if (fuBefore === fuAfter) {
    console.log(`  • إجمالي المتابعات (FollowUp): قبل=${fuBefore} بعد=${fuAfter} ✅ لم يتغيّر — التاريخ محفوظ.`);
  } else {
    console.log("\n" + "!".repeat(60));
    console.log(`  ❌❌ تنبيه فوري: عدد المتابعات تغيّر! قبل=${fuBefore} بعد=${fuAfter} (فرق ${fuAfter - fuBefore}).`);
    console.log(`  الاسترجاع لا يلمس المتابعات — الفرق غالبًا نشاط مستخدم متزامن. راجِع فورًا.`);
    console.log("!".repeat(60));
  }
  console.log(`  • لقطة التراجع محفوظة: ${outPath}`);
}

main().catch((e) => { console.error("❌ خطأ:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
