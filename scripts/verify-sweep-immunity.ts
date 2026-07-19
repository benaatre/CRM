// فحص أهلية السحب — يثبت الحالات الخمس على منطق الأهلية النقي (نفس المستخدم في الـsweep الفعلي).
// صفر كتابة على القاعدة (منطق نقي فقط). تشغيل: npx tsx scripts/verify-sweep-immunity.ts
import {
  sweepEligible, sweepIneligibleReason, initialDistributeEligible,
  type SweepEligibilityInput, type TimeoutSettings, type CutoffSettings,
} from "../src/lib/sweep-eligibility";

const NOW = new Date("2026-07-19T20:00:00.000Z");
const settings: TimeoutSettings & CutoffSettings = {
  distTimeoutMin: 48 * 60,                              // ٤٨ ساعة
  sweepCutoffAt: new Date("2026-07-10T00:00:00.000Z"), // الحاجز التاريخي
};

// قاعدة أساس: ليد متأخّر فعلًا (بعد الحاجز، مضى ٤ أيام > ٤٨س، NEW، بلا تواصل/متابعة/يدوي).
const base: SweepEligibilityInput = {
  assignedToId: "emp-1",
  assignedAt: new Date("2026-07-15T20:00:00.000Z"), // بعد الحاجز، متأخّر
  createdAt: new Date("2026-07-15T19:00:00.000Z"),  // ليس «جديدًا فعلًا» (>٦س)
  contactedAt: null,
  isArchived: false,
  stage: "NEW",
  reassignCount: 0,
  manualAssignedAt: null,
  hasFollowUp: false,
};

let pass = 0, fail = 0;
function check(n: number, title: string, got: boolean, expectMoved: boolean, detail: string) {
  const ok = got === expectMoved;
  ok ? pass++ : fail++;
  const verdict = expectMoved ? "يتحرّك" : "محميّ/لا يُسحب";
  console.log(`${ok ? "✅" : "❌"} [${n}] ${title}\n     النتيجة: ${got ? "مؤهّل للحركة" : "غير مؤهّل"} — المتوقّع: ${verdict}${detail ? `\n     ${detail}` : ""}`);
}

console.log("=== فحص الحصانة والحاجز (منطق نقي، صفر كتابة) ===\n");

// [١] له FollowUp واحدة → محمي
const c1 = { ...base, hasFollowUp: true };
check(1, "ليد عنده FollowUp واحدة", sweepEligible(c1, settings, NOW), false, `السبب: ${sweepIneligibleReason(c1, settings, NOW)}`);

// [٢] أُسند يدويًا قبل شهر → محمي (حصانة دائمة)
const c2 = { ...base, manualAssignedAt: new Date("2026-06-19T00:00:00.000Z") };
check(2, "ليد أُسند يدويًا قبل شهر", sweepEligible(c2, settings, NOW), false, `السبب: ${sweepIneligibleReason(c2, settings, NOW)}`);

// [٣] assignedAt قبل الحاجز التاريخي → محمي
const c3 = { ...base, assignedAt: new Date("2026-07-05T00:00:00.000Z"), createdAt: new Date("2026-07-05T00:00:00.000Z") };
check(3, "ليد assignedAt قبل sweepCutoffAt", sweepEligible(c3, settings, NOW), false, `السبب: ${sweepIneligibleReason(c3, settings, NOW)}`);

// [٤] ليد مُسند (assignedToId ≠ null) → التوزيع الأولي ما يلمسه
const c4moved = initialDistributeEligible({ assignedToId: "emp-1", stage: "NEW", isArchived: false });
check(4, "التوزيع الأولي vs ليد مُسند", c4moved, false, "initialDistributeEligible لازم يرجّع false للمُسند");

// [٥] ليد جديد NEW غير مُسند بعد الـcutoff → يتوزّع تلقائيًا (الوحيد اللي يتحرّك)
const c5moved = initialDistributeEligible({ assignedToId: null, stage: "NEW", isArchived: false });
check(5, "ليد NEW غير مُسند", c5moved, true, "التوزيع الأولي يلتقطه (توزيع، مو سحب)");

// [٦ — إضافي] إثبات أن السحب ما زال يعمل: ليد مؤهّل فعلًا → يُرشَّح (لا يُنفّذ تلقائيًا)
check(6, "ليد متأخّر مؤهّل (يُرشَّح للمالك فقط)", sweepEligible(base, settings, NOW), true, "مؤهّل للترشيح → يظهر للمالك بزر «اسحب/اترك»، بلا نقل تلقائي");

console.log(`\n=== النتيجة: ${pass} نجح · ${fail} فشل ===`);
if (fail > 0) process.exit(1);
