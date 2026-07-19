/**
 * scripts/restore-pulled-leads.ts — طوارئ إنتاج: استرجاع عملاء سحبهم runReassignSweep بالخطأ.
 *
 * السياق: عملاء وزّعهم المالك يدويًا، لكن contactedAt=null (تواصل بالجوال بدون تسجيل)، فرآهم
 * الكرون «متأخرين» وأعاد توجيههم. نرجّع كل عميل لموظفه الأصلي من أول سجل Reassignment(timeout).
 *
 * مبادئ الأمان:
 *  - dry-run افتراضي — لا يكتب شيئًا إلا مع --execute.
 *  - يلمس فقط reason=timeout (السحب التلقائي). لا يمسّ initial / owner_pull / أي نقل يدوي.
 *  - «الأول» في النافذة هو الأصل (لو انسحب أكثر من مرة، الأول هو المالك الحقيقي — مو الأخير).
 *  - يستثني من صار محجوز/مباع بعد السحب (RESERVED/CLOSED_WON) → قائمة مراجعة يدوية.
 *  - يستثني من تحرّك بعد السحب (assignedToId ما عاد يساوي وجهة الكرون) → قد يكون المالك عدّله.
 *  - المرحلة (stage) والمتابعات (FollowUp) لا تتغيّر إطلاقًا.
 *
 * التشغيل:
 *   npx tsx --env-file=.env scripts/restore-pulled-leads.ts                 # dry-run (افتراضي)
 *   npx tsx --env-file=.env scripts/restore-pulled-leads.ts --execute       # تنفيذ فعلي
 *   خيارات: --since=2026-07-19T00:00:00+03:00   --reason=timeout
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

// المراحل التي تمنع الاسترجاع التلقائي (سجل شبه-مالي) — تُراجع يدويًا.
const BLOCKED_STAGES = new Set(["RESERVED", "CLOSED_WON"]);
// وسم السجلات المُسترجَعة حتى لا تفسد تقارير reason.
const REVERTED_REASON = "reverted_bug";
const KSA_OFFSET_MS = 3 * 60 * 60 * 1000;

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : undefined;
}
const EXECUTE = process.argv.includes("--execute");
const REASON = arg("reason") ?? "timeout";

function ksa(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d);
}

/** بداية «اليوم» بتوقيت الرياض كـ Date عالمي (منتصف ليل الرياض). */
function ksaTodayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + KSA_OFFSET_MS);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(midnight - KSA_OFFSET_MS);
}

async function main() {
  const now = new Date();
  const sinceRaw = arg("since");
  const since = sinceRaw ? new Date(sinceRaw) : ksaTodayStart(now);
  if (Number.isNaN(since.getTime())) throw new Error(`--since غير صالح: ${sinceRaw}`);

  console.log("=".repeat(96));
  console.log(`استرجاع عملاء مسحوبين — ${EXECUTE ? "🔴 تنفيذ فعلي (--execute)" : "🟢 dry-run (بلا كتابة)"}`);
  console.log(`النافذة: من ${ksa(since)} KSA حتى الآن  |  reason = "${REASON}"`);
  console.log("=".repeat(96));

  // سجلات السحب في النافذة (تصاعدي زمنيًا → أول سجل لكل عميل هو الأصل).
  const recs = await prisma.reassignment.findMany({
    where: { createdAt: { gte: since }, reason: REASON },
    orderBy: { createdAt: "asc" },
    select: { id: true, leadId: true, fromUserId: true, toUserId: true, createdAt: true },
  });
  if (recs.length === 0) { console.log("\nما فيه سجلات في النافذة. لا شيء للاسترجاع."); return; }

  // أول سجل لكل عميل = الأصل. نجمّع كل سجلات العميل في النافذة (للوسم).
  const firstByLead = new Map<string, (typeof recs)[number]>();
  const allByLead = new Map<string, string[]>();
  for (const r of recs) {
    if (!firstByLead.has(r.leadId)) firstByLead.set(r.leadId, r);
    (allByLead.get(r.leadId) ?? allByLead.set(r.leadId, []).get(r.leadId)!).push(r.id);
  }

  const leadIds = [...firstByLead.keys()];
  const [leads, users] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, stage: true, assignedToId: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const uName = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? `?${id.slice(-6)}` : "—");

  type Plan = { leadId: string; name: string; original: string; current: string | null; recIds: string[] };
  const plan: Plan[] = [];
  const blocked: { name: string; stage: string; id: string }[] = [];
  const movedSince: { name: string; wentTo: string; nowAt: string | null; id: string }[] = [];
  const noOrigin: { name: string; id: string }[] = [];
  const alreadyOk: { name: string; id: string }[] = [];

  for (const leadId of leadIds) {
    const first = firstByLead.get(leadId)!;
    const lead = leadById.get(leadId);
    if (!lead) continue;
    const original = first.fromUserId;

    if (!original) { noOrigin.push({ name: lead.name, id: leadId }); continue; } // لا مالك أصلي (كان غير موزّع)
    if (BLOCKED_STAGES.has(lead.stage)) { blocked.push({ name: lead.name, stage: lead.stage, id: leadId }); continue; }
    if (lead.assignedToId === original) { alreadyOk.push({ name: lead.name, id: leadId }); continue; } // صحيح أصلاً
    // تحرّك بعد السحب؟ (ما عاد عند وجهة الكرون) → قد يكون تعديل يدوي لاحق، لا نكتب فوقه.
    if (lead.assignedToId !== first.toUserId) {
      movedSince.push({ name: lead.name, wentTo: uName(first.toUserId), nowAt: uName(lead.assignedToId), id: leadId });
      continue;
    }
    plan.push({ leadId, name: lead.name, original, current: lead.assignedToId, recIds: allByLead.get(leadId)! });
  }

  // ===== جدول الاسترجاع =====
  console.log(`\nسجلات النافذة: ${recs.length}  |  عملاء فريدون: ${leadIds.length}  |  ✅ للاسترجاع: ${plan.length}`);
  console.log("-".repeat(96));
  console.log("العميل                     | من (الآن) → إلى (الأصلي)");
  console.log("-".repeat(96));
  for (const p of plan) {
    console.log(`${p.name.slice(0, 26).padEnd(26)} | ${(uName(p.current) ?? "—").slice(0, 16).padEnd(16)} → ${uName(p.original)}`);
  }

  // ===== قوائم الاستثناء (للمراجعة اليدوية) =====
  if (blocked.length) {
    console.log(`\n⚠️  مُستثنون — صاروا محجوز/مباع (راجعهم يدويًا): ${blocked.length}`);
    for (const b of blocked) console.log(`     - ${b.name} (${b.stage}) [${b.id}]`);
  }
  if (movedSince.length) {
    console.log(`\n⚠️  مُستثنون — تحرّكوا بعد السحب (ليسوا عند وجهة الكرون الآن): ${movedSince.length}`);
    for (const m of movedSince) console.log(`     - ${m.name}: سحبه الكرون لـ${m.wentTo}، الآن عند ${m.nowAt} [${m.id}]`);
  }
  if (alreadyOk.length) {
    console.log(`\nℹ️  عند مالكهم الأصلي أصلاً (لا حاجة): ${alreadyOk.length}`);
  }
  if (noOrigin.length) {
    console.log(`\nℹ️  بلا مالك أصلي في السجل (كانوا غير موزّعين): ${noOrigin.length}`);
    for (const n of noOrigin) console.log(`     - ${n.name} [${n.id}]`);
  }

  // ===== التنفيذ =====
  if (!EXECUTE) {
    console.log("\n" + "=".repeat(96));
    console.log(`🟢 dry-run — لم تُكتب أي بيانات. للتنفيذ الفعلي: أضف --execute`);
    console.log(`سيُسترجَع ${plan.length} عميل عند التنفيذ.`);
    return;
  }

  const planLeadIds = plan.map((p) => p.leadId);
  const allRecIds = plan.flatMap((p) => p.recIds);

  // ===== (أ) لقطة تراجع — الحالة الحالية بالضبط قبل أي كتابة =====
  const snapLeads = await prisma.lead.findMany({
    where: { id: { in: planLeadIds } },
    select: { id: true, assignedToId: true, assignedAt: true, reassignCount: true, contactedAt: true, stage: true },
  });
  const snapshot = {
    createdAt: now.toISOString(),
    note: "لقطة الحالة قبل استرجاع عملاء سحبهم runReassignSweep — للتراجع عند الحاجة",
    window: { since: since.toISOString(), reason: REASON },
    count: snapLeads.length,
    leads: snapLeads.map((l) => ({
      leadId: l.id,
      assignedToId: l.assignedToId,
      assignedAt: l.assignedAt ? l.assignedAt.toISOString() : null,
      reassignCount: l.reassignCount,
      contactedAt: l.contactedAt ? l.contactedAt.toISOString() : null,
    })),
  };
  const outDir = join(process.cwd(), "scripts", "out");
  mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `rollback-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log("\n" + "=".repeat(96));
  console.log(`💾 لقطة التراجع: ${outPath}`);
  console.log(`   عدد السجلات في اللقطة: ${snapshot.count}  (لازم ${plan.length})`);
  if (snapshot.count !== plan.length) {
    throw new Error(`عدد اللقطة (${snapshot.count}) ≠ عدد الخطة (${plan.length}) — إيقاف قبل الكتابة.`);
  }

  // قياس ما قبل: إجمالي المتابعات + بصمة المراحل للـ٦٩ عميل (للمقارنة بعد التنفيذ).
  const followUpsBefore = await prisma.followUp.count({ where: { leadId: { in: planLeadIds } } });
  const stageBefore = new Map(snapLeads.map((l) => [l.id, l.stage]));

  // ===== (ب) التنفيذ — transaction واحدة، كل شي أو لا شي =====
  console.log(`\n🔴 تنفيذ الاسترجاع لـ ${plan.length} عميل في transaction واحدة…`);
  const updated = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const p of plan) {
      // (١) إرجاع الإسناد — مهلة جديدة، تصفير العدّاد. المرحلة والمتابعات وcontactedAt لا تُلمس.
      await tx.lead.update({
        where: { id: p.leadId },
        data: { assignedToId: p.original, assignedAt: now, reassignCount: 0 },
      });
      n++;
    }
    // (٢) وسم كل سجلات السحب المُسترجَعة دفعة واحدة حتى لا تفسد تقارير reason.
    await tx.reassignment.updateMany({ where: { id: { in: allRecIds } }, data: { reason: REVERTED_REASON } });
    // (٣) سجل تدقيق لكل عملية.
    await tx.auditLog.createMany({
      data: plan.map((p) => ({
        userId: null, action: "lead.reverted_bug", entity: "lead", entityId: p.leadId,
        summary: `استرجاع بعد سحب كرون خاطئ: رجع من ${uName(p.current)} إلى ${uName(p.original)} (سكربت طوارئ)`,
      })),
    });
    return n;
  }, { maxWait: 20_000, timeout: 120_000 });

  console.log(`\n✅ transaction نجحت كوحدة واحدة. عدد الليدات المحدّثة: ${updated}  (لازم ${plan.length})`);

  // ===== (ج) تحقّقات ما بعد التنفيذ (قراءة من القاعدة) =====
  console.log("\n" + "-".repeat(96));
  console.log("تحقّقات ما بعد التنفيذ:");

  // revalidatePath — الصفحات force-dynamic فلا كاش ثابت؛ ولا يمكن استدعاؤه من سكربت مستقل.
  let revalMsg: string;
  try {
    const { revalidatePath } = await import("next/cache");
    for (const p of ["/leads", "/pipeline", "/dashboard", "/distribution"]) revalidatePath(p);
    revalMsg = "revalidatePath نودي للمسارات الأربعة (leads, pipeline, dashboard, distribution)";
  } catch (e) {
    revalMsg = `revalidatePath لا يُنفَّذ من سكربت مستقل (${(e as Error).message?.slice(0, 50)}…) — لكن الصفحات الأربع force-dynamic فتقرأ من القاعدة عند كل طلب، فلا حاجة لإبطال كاش`;
  }
  console.log(`  • ${revalMsg}`);

  // إعادة عدّ من القاعدة: توزيع الـ٦٩ على الموظفين الآن.
  const after = await prisma.lead.findMany({ where: { id: { in: planLeadIds } }, select: { id: true, assignedToId: true, stage: true } });
  const byOwner = new Map<string, number>();
  for (const l of after) byOwner.set(l.assignedToId ?? "—", (byOwner.get(l.assignedToId ?? "—") ?? 0) + 1);
  console.log("  • توزيع الـ٦٩ المسترجَعين حسب الموظف الآن (من القاعدة):");
  for (const [uid, cnt] of [...byOwner.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${(uName(uid) ?? "—").padEnd(16)} : ${cnt}`);
  }

  // تأكيد وسم reason=reverted_bug.
  const revertedCount = await prisma.reassignment.count({ where: { id: { in: allRecIds }, reason: REVERTED_REASON } });
  console.log(`  • سجلات Reassignment المعلَّمة reason="${REVERTED_REASON}": ${revertedCount}  (لازم ${allRecIds.length})`);

  // تأكيد المتابعات لم تتغيّر.
  const followUpsAfter = await prisma.followUp.count({ where: { leadId: { in: planLeadIds } } });
  console.log(`  • إجمالي المتابعات (FollowUp): قبل=${followUpsBefore}  بعد=${followUpsAfter}  ${followUpsBefore === followUpsAfter ? "✅ لم يتغيّر" : "❌ تغيّر!"}`);

  // تأكيد المراحل لم تتغيّر.
  const stageChanged = after.filter((l) => stageBefore.get(l.id) !== l.stage);
  console.log(`  • المراحل (stage) المتغيّرة: ${stageChanged.length}  ${stageChanged.length === 0 ? "✅ كلها ثابتة" : "❌ تغيّرت!"}`);
  for (const l of stageChanged) console.log(`      - ${l.id}: ${stageBefore.get(l.id)} → ${l.stage}`);

  console.log("\n" + "=".repeat(96));
  console.log(`✅ اكتمل الاسترجاع. لقطة التراجع محفوظة في: ${outPath}`);
}

main()
  .catch((e) => { console.error("❌ خطأ:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
