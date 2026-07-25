/**
 * scripts/diagnose-week-score.ts — تشخيص (قراءة فقط) لدرجة الأسبوع: تفكيك كامل لكل موظف
 * بأرقام الأسبوع الفعلية + فحوص صحّة الحساب نفسه (نافذة الأسبوع · تمييز العملاء ·
 * نسبة الزيارات/المواعيد · حدود معامل الجودة).
 *
 * التشغيل: npx tsx --conditions=react-server --env-file=.env scripts/diagnose-week-score.ts [اسم1] [اسم2]
 */
import Module from "node:module";
import { PrismaClient, FollowUpResult } from "@prisma/client";

// «server-only» تجيء من Next وقت البناء — خارجه نبطّلها عشان نستدعي منطق اللوحة نفسه بلا نسخ.
const origResolve = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: unknown })._resolveFilename = function (req: string, ...rest: unknown[]) {
  if (req === "server-only") return origResolve.call(this, "node:util", ...rest);
  return origResolve.call(this, req, ...rest);
};

const { getLeaderboard, WEIGHTS, DAILY_FOLLOWUP_CAP } = require("../src/lib/data/leaderboard") as typeof import("../src/lib/data/leaderboard");

const prisma = new PrismaClient();
const DAY_MS = 86_400_000;
const KSA = 3 * 3_600_000;
const ar = (n: number) => n.toLocaleString("ar-SA-u-nu-latn");
const fmt = (d: Date) => new Intl.DateTimeFormat("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }).format(d);

const TARGETS = process.argv.slice(2).length ? process.argv.slice(2) : ["مها", "أسماء", "اسماء"];

async function main() {
  const now = new Date();
  const board = await getLeaderboard(now);
  const weekStart = board.weekStart, weekEnd = board.weekEnd;

  console.log("=".repeat(100));
  console.log(`نافذة الأسبوع المحسوبة: من ${fmt(weekStart)} إلى ${fmt(weekEnd)} (بتوقيت الرياض)`);
  console.log(`بالـUTC الخام: ${weekStart.toISOString()} → ${weekEnd.toISOString()}`);
  console.log("=".repeat(100));

  const all = [...board.rows, ...board.unranked];
  const picked = all.filter((r) => TARGETS.some((t) => r.name.includes(t)));
  const show = picked.length ? picked : all;

  // ===== ١) التفكيك الكامل =====
  for (const r of show) {
    console.log("");
    console.log(`### ${r.name}  —  الترتيب ${r.rank || "خارج الترتيب"}  ·  الدرجة ${ar(r.score)}`);
    const lines: [string, number, number][] = [
      ["تواصل (عملاء مميزون)", r.contacted, WEIGHTS.contacted],
      [`متابعات (بعد سقف ${DAILY_FOLLOWUP_CAP}/يوم — الخام ${ar(r.followups)})`, r.cappedFollowups, WEIGHTS.followup],
      ["مهتمون", r.interested, WEIGHTS.interested],
      ["مواعيد زيارة", r.visitAppts, WEIGHTS.visitAppt],
      ["زيارات تمّت", r.visitsDone, WEIGHTS.visitDone],
      ["حجوزات", r.bookings, WEIGHTS.booking],
      ["مبيعات", r.wins, WEIGHTS.win],
    ];
    for (const [label, count, w] of lines) {
      console.log(`   ${label.padEnd(52)} ${String(count).padStart(4)} × ${String(w).padStart(2)} = ${String(count * w).padStart(5)}`);
    }
    console.log(`   ${"الإنجاز".padEnd(52)} ${" ".repeat(13)}${String(r.achievement).padStart(5)}`);
    const p = r.parts;
    console.log(`   الجودة: تغطية ${p.coverage}% (${p.covered}/${p.assignedActive})×0.${p.speedScore == null ? "47" : "35"}` +
      ` · التزام ${p.punctuality}% (${p.fulfilled}/${p.dueCount})` +
      ` · سرعة ${p.speedScore == null ? "غير متاحة" : p.speedScore + "% (متوسط " + p.avgFirstResponseH + "س)"}` +
      ` · نظافة ${p.overdueBonus}% (متأخرون ${p.overdueCount})`);
    console.log(`   الجودة المركّبة = ${r.qualityPct}%  →  المعامل = ${r.qualityFactor}`);
    console.log(`   الدرجة = ${ar(r.achievement)} × ${r.qualityFactor} = ${ar(r.score)}`);
  }

  // ===== ٢) المقارنة جنبًا لجنب (أول اثنين) =====
  if (show.length >= 2) {
    const [a, b] = show;
    console.log("\n" + "=".repeat(100));
    console.log(`مقارنة: ${a.name}  ⟷  ${b.name}   (الفارق بالدرجة = ${ar(a.score - b.score)})`);
    console.log("-".repeat(100));
    const rows: [string, number, number, number][] = [
      ["تواصل ×2", a.contacted * 2, b.contacted * 2, 0],
      ["متابعات ×1", a.cappedFollowups, b.cappedFollowups, 0],
      ["مهتمون ×5", a.interested * 5, b.interested * 5, 0],
      ["مواعيد ×5", a.visitAppts * 5, b.visitAppts * 5, 0],
      ["زيارات ×10", a.visitsDone * 10, b.visitsDone * 10, 0],
      ["حجوزات ×50", a.bookings * 50, b.bookings * 50, 0],
      ["مبيعات ×80", a.wins * 80, b.wins * 80, 0],
      ["= الإنجاز", a.achievement, b.achievement, 0],
    ];
    for (const [l, x, y] of rows) console.log(`${l.padEnd(20)} ${String(x).padStart(6)} | ${String(y).padStart(6)}  → فرق ${String(x - y).padStart(6)}`);
    console.log(`${"معامل الجودة".padEnd(20)} ${String(a.qualityFactor).padStart(6)} | ${String(b.qualityFactor).padStart(6)}`);
    console.log(`${"الدرجة".padEnd(20)} ${String(a.score).padStart(6)} | ${String(b.score).padStart(6)}`);
  }

  // ===== ٣) فحوص صحّة الحساب =====
  console.log("\n" + "=".repeat(100));
  console.log("فحوص صحّة الحساب");
  console.log("-".repeat(100));

  // أ) نافذة الأسبوع: كم متابعة تدخل/تخرج لو حُسبت بالـUTC بدل الرياض؟
  const utcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  const lo = new Date(Math.min(weekStart.getTime(), utcStart.getTime()));
  const hi = new Date(Math.max(weekStart.getTime(), utcStart.getTime()));
  const boundaryFus = await prisma.followUp.findMany({
    where: { createdAt: { gte: lo, lt: hi } },
    select: { createdBy: true, createdAt: true },
  });
  console.log(`أ) بداية الأسبوع بالرياض = ${weekStart.toISOString()} · بالـUTC = ${utcStart.toISOString()}`);
  console.log(`   المتابعات الواقعة في فجوة الـ٣ ساعات بين الحدّين: ${boundaryFus.length}`);
  if (boundaryFus.length) {
    const byEmp = new Map<string, number>();
    for (const f of boundaryFus) byEmp.set(f.createdBy, (byEmp.get(f.createdBy) ?? 0) + 1);
    const names = await prisma.user.findMany({ where: { id: { in: [...byEmp.keys()] } }, select: { id: true, name: true } });
    for (const u of names) console.log(`     ${u.name}: ${byEmp.get(u.id)}`);
  }

  // ب) «تواصل» distinct؟ مقارنة مباشرة بالخام
  const weekFus = await prisma.followUp.findMany({
    where: { createdAt: { gte: weekStart, lt: weekEnd } },
    select: { createdBy: true, leadId: true, result: true, createdAt: true },
  });
  const rawByEmp = new Map<string, { total: number; distinct: Set<string> }>();
  for (const f of weekFus) {
    let e = rawByEmp.get(f.createdBy);
    if (!e) { e = { total: 0, distinct: new Set() }; rawByEmp.set(f.createdBy, e); }
    e.total++; e.distinct.add(f.leadId);
  }
  console.log("ب) «تواصل معه» = عملاء مميزون؟ (خام مقابل مميز مقابل المعروض)");
  for (const r of show) {
    const e = rawByEmp.get(r.id);
    console.log(`   ${r.name}: خام=${e?.total ?? 0} · مميز=${e?.distinct.size ?? 0} · اللوحة تعرض=${r.contacted}  ${(e?.distinct.size ?? 0) === r.contacted ? "✅" : "❌"}`);
  }

  // ج) نسبة الزيارات/المواعيد: كاتب المتابعة أم مالك العميل الحالي؟
  const visitResults: FollowUpResult[] = [
    FollowUpResult.INTERESTED_VISIT_SCHEDULED, FollowUpResult.INTERESTED_VISITED, FollowUpResult.NOT_INTERESTED_VISITED,
  ];
  const visitFus = await prisma.followUp.findMany({
    where: { createdAt: { gte: weekStart, lt: weekEnd }, result: { in: visitResults } },
    select: { createdBy: true, leadId: true, result: true, lead: { select: { assignedToId: true } } },
  });
  const mismatched = visitFus.filter((f) => f.lead.assignedToId && f.lead.assignedToId !== f.createdBy);
  console.log(`ج) متابعات الزيارة/الموعد هذا الأسبوع: ${visitFus.length} · منها كاتبها ≠ مالك العميل الحالي: ${mismatched.length}`);
  console.log(`   (اللوحة تنسبها لكاتب المتابعة createdBy — لا لمالك العميل)`);

  // د) حدود معامل الجودة + أثر السرعة
  console.log("د) معامل الجودة — الحدود وأثر «سرعة الاستجابة»:");
  for (const r of all) {
    const ok = r.qualityFactor >= 0.8 && r.qualityFactor <= 1.2;
    console.log(`   ${r.name.padEnd(16)} جودة=${String(r.qualityPct).padStart(3)}% معامل=${r.qualityFactor} ${ok ? "✅" : "❌ خارج الحد"}` +
      ` · عملاء جدد هذا الأسبوع=${r.parts.speedScore == null ? 0 : "؟"} · سرعة=${r.parts.speedScore ?? "—"}`);
  }
  const newAssigned = await prisma.lead.groupBy({
    by: ["assignedToId"],
    where: { assignedAt: { gte: weekStart, lt: weekEnd }, assignedToId: { not: null } },
    _count: { _all: true },
  });
  const nameMap = new Map(all.map((r) => [r.id, r.name]));
  console.log("   عملاء جدد أُسندوا هذا الأسبوع (مقام «سرعة الاستجابة»):");
  for (const g of newAssigned) console.log(`     ${(nameMap.get(g.assignedToId as string) ?? g.assignedToId)?.padEnd(16)} ${g._count._all}`);

  // هـ) الترتيب النهائي
  console.log("\nالترتيب النهائي:");
  for (const r of board.rows) console.log(`   ${r.rank}. ${r.name.padEnd(16)} درجة=${String(r.score).padStart(5)} (إنجاز ${String(r.achievement).padStart(5)} × ${r.qualityFactor})`);
  if (board.unranked.length) console.log(`   خارج الترتيب: ${board.unranked.map((r) => r.name).join("، ")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
