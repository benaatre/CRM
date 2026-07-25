/**
 * scripts/verify-followup-rule.ts — حارس «القاعدة الصارمة» (تحقيق المتابعات الشبحية).
 *
 *   أي إجراء تلقائي للنظام لا ينشئ FollowUp منسوبة لموظف أبدًا.
 *   التغييرات الآلية = Lead.stage + Activity + AuditLog باسم «النظام» (userId = null) فقط.
 *
 * يفحص المصدر لا القاعدة: يعثر على كل موضع ينشئ FollowUp ويتأكد أنه في ملف
 * «بشري» (مسار طلب أو Server Action يملك جلسة)، وأن `createdBy` مأخوذ من الجلسة
 * لا من ثابت ولا من مالك العميل. أي موضع جديد خارج القائمة يُسقط الفحص.
 *
 * التشغيل: npx tsx scripts/verify-followup-rule.ts   (بلا قاعدة بيانات — فحص مصدر فقط)
 * يُنصح بتشغيله قبل كل نشر.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "scripts", "prisma"];

/** ملفات يُسمح لها بإنشاء متابعة — كلها تعمل داخل جلسة مستخدم حقيقية. */
const HUMAN_PATHS = [
  "src/app/api/leads/[id]/followups/route.ts", // نموذج المتابعة (الموظف/المدير)
  "src/app/api/leads/[id]/whatsapp/route.ts",  // ضغط زر «إرسال واتساب»
  "src/lib/actions/bookings.ts",               // حجز · شراء فوري · إلغاء حجز
];

/** مسارات تلقائية بحتة — ممنوع منعًا باتًّا أن تنشئ متابعة. */
const AUTOMATED_HINTS = [
  "src/lib/notifications/scheduled.ts",
  "src/lib/auto-distribute.ts",
  "src/lib/no-response-escalation.ts",
  "src/lib/sheet-sync-google.ts",
  "src/app/api/sync-sheets/route.ts",
  "src/app/api/auto-distribute/route.ts",
  "src/app/api/notify-scheduled/route.ts",
];

const CREATE_RE = /(?:tx|prisma|db)\.followUp\.(create|createMany|upsert)\b|followUps:\s*\{\s*create/g;
/** createdBy يجب أن يأتي من الجلسة (user.id / session.user.id / actor…) لا من ثابت. */
const SESSION_ACTOR_RE = /createdBy:\s*(?:user\.id|session\.user\.id|a\.user\.id|actor(?:Id)?\b)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => {
  try { return walk(join(ROOT, d)); } catch { return []; }
});

const violations: string[] = [];
const found: { file: string; count: number; sessionActor: boolean }[] = [];

for (const abs of files) {
  const rel = relative(ROOT, abs).replace(/\\/g, "/");
  const src = readFileSync(abs, "utf8");
  const hits = src.match(CREATE_RE);
  if (!hits) continue;

  found.push({ file: rel, count: hits.length, sessionActor: SESSION_ACTOR_RE.test(src) });

  if (AUTOMATED_HINTS.includes(rel)) {
    violations.push(`⛔ مسار تلقائي ينشئ متابعة: ${rel} (${hits.length} موضع) — ممنوع بالقاعدة.`);
    continue;
  }
  if (!HUMAN_PATHS.includes(rel)) {
    violations.push(`⛔ موضع إنشاء متابعة جديد خارج القائمة المعتمدة: ${rel} (${hits.length} موضع).\n   لو كان بفعل بشري بجلسة، أضفه إلى HUMAN_PATHS هنا مع تعليل. لو كان تلقائيًا، احذفه.`);
    continue;
  }
  if (!SESSION_ACTOR_RE.test(src)) {
    violations.push(`⛔ ${rel}: createdBy لا يأتي من الجلسة — القاعدة تمنع نسبة متابعة لغير الفاعل الحقيقي.`);
  }
}

console.log("حارس قاعدة المتابعات — مواضع إنشاء FollowUp في المصدر:");
for (const f of found.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log(`   ${f.sessionActor ? "✅" : "⚠️ "} ${f.file.padEnd(48)} ${f.count} موضع`);
}

if (violations.length) {
  console.error("\n" + violations.join("\n"));
  console.error(`\nفشل الفحص: ${violations.length} مخالفة.`);
  process.exitCode = 1;
} else {
  console.log(`\n✅ القاعدة سليمة: ${found.length} ملفًا ينشئ متابعات، كلها بفعل بشري و createdBy من الجلسة.`);
  console.log("   ولا مسار تلقائي واحد ينشئ FollowUp.");
}
