import "server-only";

import type { LeadStage, FollowUpResult, Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { dedupeKey, LIVE_ROWS_ONLY } from "@/lib/phone-dupe";
import { dayStartKSA, DAY_MS } from "@/lib/ksa-time";

export type DupMember = {
  id: string;
  name: string;
  phone: string;              // الصيغة المخزّنة الأصلية (للتواصل)
  createdAt: Date;
  stage: LeadStage;
  assignedToId: string | null;
  assignedToName: string | null;
  channel: Channel;           // القناة (الإعلان الخشن)
  sourceName: string | null;  // المصدر المهيكل أو نص المصدر
  lastFollowUp: { result: FollowUpResult; createdAt: Date } | null;
  /** انضاف اليوم (بتوقيت الرياض) — شارة «جديد اليوم». */
  addedToday: boolean;
};

export type DupGroup = {
  key: string;            // آخر ٩ أرقام (مفتاح التجميع)
  phone: string;          // صيغة أقدم سجل — عنوان المجموعة
  duplicateCount: number; // عدد السجلات الحيّة بنفس الرقم
  firstAddedAt: Date;     // أقدم إضافة (مع مين مكرر)
  lastAddedAt: Date;      // أحدث إضافة — ترتيب المجموعات
  /** فيها سجل «محجوز» (RESERVED) — تحذير «مكرر مع محجوز!»: محجوبة عن التوزيع التلقائي والقرار للمالك. */
  hasReserved: boolean;
  /** انضاف لها سجل اليوم (بتوقيت الرياض) — فلتر «اليوم» وعدّاده. */
  newToday: boolean;
  members: DupMember[];   // مرتّبة بالأقدم أولًا (يتضح مع مين المكرر)
};

export type DuplicatesData = {
  groups: DupGroup[];       // الأحدث إضافةً أولًا
  totalGroups: number;
  newTodayGroups: number;
};

/**
 * العملاء المكررون — مجموعات الصفوف **الحيّة** (غير مؤرشف + مرحلة غير مقفولة) التي
 * يتشارك فيها سجلان فأكثر نفس آخر-٩ أرقام. نفس شرط LIVE_ROWS_ONLY الذي يحجب بهم
 * التوزيع التلقائي (duplicateLeadIds) حرفيًا — فما يظهر بالصفحة هو ما يُحجَب بالمحرك،
 * ويشمل ذلك «مكرر مع محجوز» (RESERVED حيّ): يظهر بشارة تحذير والقرار للمالك يدويًا.
 * حلّ المجموعة (توزيع/أرشفة حتى يبقى صف حيّ واحد) يفكّ الحجب تلقائيًا.
 */
export async function getDuplicateLeads(): Promise<DuplicatesData> {
  const user = await requireUser();
  if (user.role !== "OWNER") return { groups: [], totalGroups: 0, newTodayGroups: 0 };

  // ١) الصفوف الحيّة بالحقول اللازمة — استعلام واحد، وPrisma لا يدعم groupBy على تعبير
  //    (آخر ٩) فنجمّع بالذاكرة.
  const leads = await prisma.lead.findMany({
    where: LIVE_ROWS_ONLY,
    select: {
      id: true, name: true, phone: true, createdAt: true, stage: true,
      channel: true, source: true, assignedToId: true,
      assignedTo: { select: { name: true } },
      leadSource: { select: { name: true } },
    },
  });

  type Row = (typeof leads)[number];
  const byKey = new Map<string, Row[]>();
  for (const l of leads) {
    const key = dedupeKey(l.phone);
    if (!key) continue;
    const arr = byKey.get(key);
    if (arr) arr.push(l);
    else byKey.set(key, [l]);
  }
  const dupEntries = [...byKey.entries()].filter(([, arr]) => arr.length > 1);
  if (dupEntries.length === 0) return { groups: [], totalGroups: 0, newTodayGroups: 0 };

  // ٢) آخر متابعة لكل سجل مكرر — استعلام واحد مجمّع (الأحدث أولًا، نلتقط الأولى لكل عميل).
  const dupIds = dupEntries.flatMap(([, arr]) => arr.map((l) => l.id));
  const fus = await prisma.followUp.findMany({
    where: { leadId: { in: dupIds } },
    select: { leadId: true, result: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const lastFuByLead = new Map<string, { result: FollowUpResult; createdAt: Date }>();
  for (const f of fus) if (!lastFuByLead.has(f.leadId)) lastFuByLead.set(f.leadId, { result: f.result, createdAt: f.createdAt });

  const todayStart = dayStartKSA(new Date());
  const build = ([key, arr]: [string, Row[]]): DupGroup => {
    const sorted = arr.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const members: DupMember[] = sorted.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      createdAt: l.createdAt,
      stage: l.stage,
      assignedToId: l.assignedToId,
      assignedToName: l.assignedTo?.name ?? null,
      channel: l.channel,
      sourceName: l.leadSource?.name ?? l.source ?? null,
      lastFollowUp: lastFuByLead.get(l.id) ?? null,
      addedToday: l.createdAt >= todayStart,
    }));
    return {
      key,
      phone: sorted[0].phone,
      duplicateCount: members.length,
      firstAddedAt: members[0].createdAt,
      lastAddedAt: members[members.length - 1].createdAt,
      hasReserved: sorted.some((l) => l.stage === "RESERVED"),
      newToday: members.some((m) => m.addedToday),
      members,
    };
  };

  // ترتيب المجموعات: الأحدث إضافةً أولًا.
  const groups = dupEntries.map(build).sort((a, b) => b.lastAddedAt.getTime() - a.lastAddedAt.getTime());
  return {
    groups,
    totalGroups: groups.length,
    newTodayGroups: groups.filter((g) => g.newToday).length,
  };
}

/** نافذة فلتر «آخر ٧ أيام» — يستخدمها العميل على lastAddedAt. */
export const DUP_WEEK_MS = 7 * DAY_MS;

// م-٥: كاش ٦٠ ثانية — الشارة تُحسب في layout المالك مع كل تنقّل/refresh وكانت تمسح الجدول كاملًا.
const BADGE_CACHE_MS = 60_000;
let badgeCache: { at: number; count: number } | null = null;

/**
 * عدّاد شارة التنقّل: عدد مجموعات المكررين المعروضة بالصفحة — **نفس منطقها حرفيًا**
 * (صفوف حيّة، مجموعات >١، شاملًا «مكرر مع محجوز» — كانت مستثناة فيمرّ الحجب بصمت).
 * استعلام واحد (phone) + تجميع بالذاكرة + كاش ٦٠ث. تُستدعى للمالك فقط.
 */
export async function activeDuplicateGroupCount(): Promise<number> {
  if (badgeCache && Date.now() - badgeCache.at < BADGE_CACHE_MS) return badgeCache.count;
  const leads = await prisma.lead.findMany({ where: LIVE_ROWS_ONLY, select: { phone: true } });
  const byKey = new Map<string, number>();
  for (const l of leads) {
    const k = dedupeKey(l.phone);
    if (!k) continue;
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  let count = 0;
  for (const n of byKey.values()) if (n > 1) count++;
  badgeCache = { at: Date.now(), count };
  return count;
}
