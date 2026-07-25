// تدقيق مطابقة شامل (قراءة فقط): الصفوف المرجعية من الشيت مقابل القاعدة.
// يطابق بالجوال المطبّع (آخر ٩ أرقام) ويقارن: الاسم المدموج · الهدف · الطريقة · الحي · السعر.
// الخرج: ✅ مطابق تمامًا · ⚠️ فرق (الحقل والقيمتان) · ❌ غير موجود في القاعدة.
// التشغيل: npx tsx scripts/verify-sheet-vs-db.ts

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient, type PurchaseGoal, type PurchaseMethod } from "@prisma/client";
import { normalizePhone, normalizePurchaseGoal, normalizePurchaseMethod } from "../src/lib/value-normalize";
import { normalizeAreas } from "../src/lib/utils/sheet-parse";

const prisma = new PrismaClient();

// الصفوف الـ٤٤ المرجعية (الاسم الأول · الأخير · الجوال · حقل ٤ · حقل ٥) — كما لُصقت.
const REF = `MOHAMMED\tAL KHALIFA\t+966598305042\t{للسكن:true}\t{تمويل بنكي غير مدعوم:true}
A.B.D\tابو فيصل \t+966554462420\t{الاثنين معاً:true}\t{تمويل بنكي غير مدعوم:true}
Yahya \tDawshi \t0551095550\t{تمويل بنكي مدعوم:true}\t{ حي المهدية:true}
ABDULLAH\tAL\t+966558305790\t{الاثنين معاً:true}\t{تمويل بنكي مدعوم:true}
Nouf🕊\tالدوسري\t+966506878110\t{الاثنين معاً:true}\t{تمويل بنكي غير مدعوم:true}
Kha\tالسعودية \t+966560073666\t{الاستثمار:true}\t{كاش:true}
خالد\tمحمد\t+966556604968\t{الاستثمار:true}\t{تمويل بنكي غير مدعوم:true}
ابن\tنشار ~\t+966506000012\t{الاثنين معاً:true}\t{تمويل بنكي غير مدعوم:true}
هدى\tعلي.\t0506481413\t{كاش:true}\t{ حي ظهرة لبن:true}
راكان\tالمسند\t+966533443054\t{تمويل بنكي مدعوم:true}\t{ حي ظهرة لبن:true}
مشاعل\tمسرحي\t+966537915163\t{تمويل بنكي مدعوم:true}\t{ حي ظهرة لبن:true}
Sa\taziz\t+966500474247\t{الاثنين معاً:true}\t{تمويل بنكي غير مدعوم:true}
نايف\tالعنزي\t0542699479\t{الاستثمار:true}\t{تمويل بنكي مدعوم:true}
Mohammed\tAlGhamdi\t0550661669\t{الاستثمار:true}\t{تمويل بنكي غير مدعوم:true}
7asan\tS.\t555702464\t{الاستثمار:true}\t{كاش:true}
Ahmed\tAlka\t+966544069696\t{الاثنين معاً:true}\t{كاش:true}
حسين\tالصغير\t+966590074151\t{الاستثمار:true}\t{كاش:true}
محسن\tمحسن\t٠٥٩٨٨٠٣٦\t{الاثنين معاً:true}\t{تمويل بنكي غير مدعوم:true}
سلطان\tالحارثي\t+966583888938\t{الاثنين معاً:true}\t{تمويل بنكي مدعوم:true}
Abdulrahman\tAloshaywan\t+966500141798\t{الاثنين معاً:true}\t{تمويل بنكي غير مدعوم:true}
HANI\tALAMOUDI\t+966595900555\t{للسكن:true}\t{كاش:true}
wafaa\talshahrani\t+966566664343\t{الاثنين معاً:true}\t{كاش:true}
Mohammed\tAlkhaldi\t0580000224\t{الاستثمار:true}\t{كاش:true}
Wa\tAlenaz\t+966548503773\t{الاستثمار:true}\t{كاش:true}
Ahmed\tALQarni\t+966551551150\t{الاستثمار:true}\t{كاش:true}
yazodetamimi\tالعصيمي\t0556233338\t{الاستثمار:true}\t{كاش:true}
بندر\tالعنزي\t+966506641066\t{الاثنين معاً:true}\t{تمويل بنكي غير مدعوم:true}
Hanan\tSh\t+966505524538\t{الاستثمار:true}\t{تمويل بنكي غير مدعوم:true}
Ibrahim\tAlnami\t+966569222723\t{الاثنين معاً:true}\t{كاش:true}
منالM\tاحمد\t+966590096406\t{الاثنين معاً:true}\t{كاش:true}
Sara\tالقحطاني\t0503108636\t{للسكن:true}\t{كاش:true}
MOHMMED\tAziz\t+966590106090\t{للسكن:true}\t{كاش:true}
AFA\tAlanazi\t0569998080\t{الاثنين معاً:true}\t{كاش:true}
أبو\tمشعل\t+966506745360\t{الاستثمار:true}\t{كاش:true}
سالم\tناحي\t+966595123494\t{الاثنين معاً:true}\t{تمويل بنكي غير مدعوم:true}
سالم\tناحي\t+966595123494\t{الاستثمار:true}\t{تمويل بنكي غير مدعوم:true}
Abu\tAbdullah\t+966504701669\t{الاستثمار:true}\t{تمويل بنكي غير مدعوم:true}
Malika\tالسناري\t+966565208209\t{الاثنين معاً:true}\t{كاش:true}
زياد\tسليمان\t0551333202\t{الاستثمار:true}\t{كاش:true}
OMAR\tHefni\t+966500070484\t{للسكن:true}\t{تمويل بنكي غير مدعوم:true}
عبدالرحمن\tالمغامسي\t0540025440\t{الاستثمار:true}\t{تمويل بنكي مدعوم:true}
THAFER\tALDAWSARI \t+966506098031\t{الاثنين معاً:true}\t{تمويل بنكي مدعوم:true}
Khaled\tAlnmy\t+966506205438\t{الاثنين معاً:true}\t{تمويل بنكي مدعوم:true}
زينب\tعبدالله\t0548897009\t{الاثنين معاً:true}\t{تمويل بنكي غير مدعوم:true}`;

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
const clean = (s: string) => s.replace(/[{}]/g, "").replace(/\s*:\s*true\s*$/i, "").replace(/\s+/g, " ").trim();

type Expected = {
  name: string; phoneRaw: string; phone9: string | null;
  goal: PurchaseGoal | null; method: PurchaseMethod | null; areas: string[];
};

/** يفسّر حقلي ٤/٥ **بالمحتوى لا الموقع** (الأعمدة مزاحة في الفورم الجديد). */
function interpret(fields: string[]): Pick<Expected, "goal" | "method" | "areas"> {
  let goal: PurchaseGoal | null = null;
  let method: PurchaseMethod | null = null;
  let areas: string[] = [];
  for (const f of fields.map(clean)) {
    if (!f) continue;
    const g = normalizePurchaseGoal(f);
    if (g && !goal) { goal = g; continue; }
    if (/(^|\s)حي(\s|$)/.test(f) || normalizeAreas(f).areas.some((a) => a !== "أخرى")) {
      if (areas.length === 0) { areas = normalizeAreas(f).areas; continue; }
    }
    const m = normalizePurchaseMethod(f);
    if (m && !method) method = m;
  }
  return { goal, method, areas };
}

async function main() {
  const refs: Expected[] = REF.split("\n").map((line) => {
    const [first, last, phoneRaw, c4, c5] = line.split("\t");
    const p = normalizePhone(latin(phoneRaw ?? ""));
    return {
      name: `${(first ?? "").trim()} ${(last ?? "").trim()}`.replace(/\s+/g, " ").trim(),
      phoneRaw: (phoneRaw ?? "").trim(),
      phone9: /^05\d{8}$/.test(p) ? p.slice(-9) : null,
      ...interpret([c4 ?? "", c5 ?? ""]),
    };
  });

  const KSA_MS = 3 * 3_600_000;
  const k = new Date(Date.now() + KSA_MS);
  const dayStart = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KSA_MS);
  const leads = await prisma.lead.findMany({
    where: { createdAt: { gte: dayStart }, leadSource: { name: { contains: "سناب" } } },
    select: { id: true, name: true, phone: true, purchaseGoal: true, purchaseMethod: true, preferredAreas: true, priceMin: true, priceMax: true },
  });
  const byPhone9 = new Map<string, typeof leads>();
  for (const l of leads) {
    const p9 = normalizePhone(l.phone).slice(-9);
    if (p9.length === 9) byPhone9.set(p9, [...(byPhone9.get(p9) ?? []), l]);
  }

  let ok = 0, diff = 0, missing = 0;
  const seenPhones = new Set<string>();
  refs.forEach((r, idx) => {
    const tag = `${String(idx + 1).padStart(2, "0")}. ${r.name}`;
    if (!r.phone9) {
      // جوال غير صالح في المرجع (محسن محسن ٨ أرقام) — محاولة مطابقة بالاسم.
      const byName = leads.find((l) => l.name.replace(/\s+/g, " ").trim() === r.name);
      console.log(`⚠️ ${tag} — جواله في الشيت غير صالح («${r.phoneRaw}») ${byName ? `· موجود بالاسم (المفروض بملاحظة جوال)` : "· ولا انلقى بالاسم"}`);
      diff++;
      return;
    }
    if (seenPhones.has(r.phone9)) {
      const cnt = byPhone9.get(r.phone9)?.length ?? 0;
      console.log(cnt <= 1
        ? `✅ ${tag} — صف مكرر بنفس الجوال: سقط بحارس المكررات (عميل واحد فقط بالقاعدة) ✓`
        : `⚠️ ${tag} — صف مكرر لكن بالقاعدة ${cnt} عميلين بنفس الجوال!`);
      cnt <= 1 ? ok++ : diff++;
      return;
    }
    seenPhones.add(r.phone9);
    const matches = byPhone9.get(r.phone9) ?? [];
    if (matches.length === 0) { console.log(`❌ ${tag} — غير موجود في القاعدة [${r.phoneRaw}]`); missing++; return; }
    const l = matches[0];
    const diffs: string[] = [];
    const dbName = l.name.replace(/\s+/g, " ").trim();
    if (dbName !== r.name) diffs.push(`الاسم: قاعدة«${dbName}» ≠ شيت«${r.name}»`);
    if ((l.purchaseGoal ?? null) !== r.goal) diffs.push(`الهدف: قاعدة«${l.purchaseGoal ?? "—"}» ≠ شيت«${r.goal ?? "—"}»`);
    if ((l.purchaseMethod ?? null) !== r.method) diffs.push(`الطريقة: قاعدة«${l.purchaseMethod ?? "—"}» ≠ شيت«${r.method ?? "—"}»`);
    const dbAreas = (l.preferredAreas ?? []).filter((a) => a !== "أخرى");
    if (r.areas.length && !r.areas.every((a) => dbAreas.includes(a))) diffs.push(`الحي: قاعدة«${dbAreas.join("+") || "—"}» ≠ شيت«${r.areas.join("+")}»`);
    if (l.priceMin != null || l.priceMax != null) diffs.push(`سعر وهمي: ${l.priceMin ?? "—"}/${l.priceMax ?? "—"} (الفورم بلا سؤال سعر)`);
    if (matches.length > 1) diffs.push(`${matches.length} عملاء بنفس الجوال`);
    if (diffs.length === 0) { console.log(`✅ ${tag}`); ok++; }
    else { console.log(`⚠️ ${tag} — ${diffs.join(" · ")}`); diff++; }
  });

  console.log(`\nالخلاصة: ✅ ${ok} مطابق · ⚠️ ${diff} فرق · ❌ ${missing} غير موجود — (من ${refs.length} صفًا مرجعيًا، وعملاء سناب اليوم بالقاعدة: ${leads.length})`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
