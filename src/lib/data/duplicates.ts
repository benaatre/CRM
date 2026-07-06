import "server-only";

import type { LeadStage, FollowUpResult, Channel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guards";
import { dedupeKey } from "@/lib/phone-dupe";

export type DupFollowUp = { result: FollowUpResult; createdAt: Date; note: string | null };

export type DupMember = {
  id: string;
  name: string;
  createdAt: Date;
  stage: LeadStage;
  assignedToName: string | null;
  lastContact: Date | null;
  channel: Channel;           // القناة (الإعلان الخشن)
  sourceName: string | null;  // المصدر المهيكل أو نص المصدر
  followups: DupFollowUp[];
};

export type DupGroup = {
  phone: string;          // الجوال المطبّع (05XXXXXXXX)
  duplicateCount: number; // عدد السجلات بنفس الرقم
  firstAddedAt: Date;     // أقدم createdAt في المجموعة
  employees: string[];    // الموظفون المميّزون على السجلات
  hasBooked: boolean;     // أي سجل RESERVED/CLOSED_WON
  members: DupMember[];   // مرتّبة بالأقدم أولًا
};

export type DuplicatesData = { active: DupGroup[]; booked: DupGroup[] };

// «محجوز/مباع» — وجود أيّها في المجموعة يعني العميل حجز/اشترى.
const BOOKED_STAGES: LeadStage[] = ["RESERVED", "CLOSED_WON"];

/**
 * العملاء المكررون = سجلات Lead بنفس رقم الجوال (count > 1). مدير/مالك فقط.
 *
 * التجميع على آخر ٩ أرقام (dedupeKey) — يعالج الصيغ المختلطة المخزّنة (يدوي خام،
 * استيراد مطبّع، +966/966/بمسافات) فتتجمّع كلها كرقم واحد. العرض يبقى بالصيغة المخزّنة
 * الأصلية (للتواصل). Prisma لا يدعم groupBy على تعبير (آخر ٩)، فنجلب ونجمّع بالكود.
 */
export async function getDuplicateLeads(): Promise<DuplicatesData> {
  const user = await requireUser();
  if (user.role !== "OWNER") return { active: [], booked: [] }; // المالك فقط

  // ١) كل العملاء بالحقول اللازمة (بلا سقف — فحص شامل للمكررات). استعلام واحد.
  const leads = await prisma.lead.findMany({
    select: {
      id: true, name: true, phone: true, createdAt: true, stage: true, lastContact: true,
      channel: true, source: true,
      assignedTo: { select: { name: true } },
      leadSource: { select: { name: true } },
    },
  });

  // ٢) تجميع على آخر ٩ أرقام (dedupeKey). الأرقام الأقصر من ٩ تُتجاهَل (غير صالحة).
  type Row = (typeof leads)[number];
  const groups = new Map<string, Row[]>();
  for (const l of leads) {
    const key = dedupeKey(l.phone);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(l);
    else groups.set(key, [l]);
  }
  const dupEntries = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  if (dupEntries.length === 0) return { active: [], booked: [] };

  // ٣) متابعات سجلات المكررين فقط — استعلام واحد مجمّع (بلا N+1).
  const dupIds = dupEntries.flatMap(([, arr]) => arr.map((l) => l.id));
  const fus = await prisma.followUp.findMany({
    where: { leadId: { in: dupIds } },
    select: { leadId: true, result: true, createdAt: true, note: true },
    orderBy: { createdAt: "asc" },
  });
  const fuByLead = new Map<string, DupFollowUp[]>();
  for (const f of fus) {
    const list = fuByLead.get(f.leadId) ?? [];
    list.push({ result: f.result, createdAt: f.createdAt, note: f.note });
    fuByLead.set(f.leadId, list);
  }

  // ٤) بناء المجموعات + التصنيف حسب hasBooked.
  const build = (arr: Row[]): DupGroup => {
    const sorted = arr.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const members: DupMember[] = sorted.map((l) => ({
      id: l.id,
      name: l.name,
      createdAt: l.createdAt,
      stage: l.stage,
      assignedToName: l.assignedTo?.name ?? null,
      lastContact: l.lastContact,
      channel: l.channel,
      sourceName: l.leadSource?.name ?? l.source ?? null,
      followups: fuByLead.get(l.id) ?? [],
    }));
    const employees = [...new Set(members.map((m) => m.assignedToName).filter((n): n is string => !!n))];
    return {
      phone: sorted[0].phone, // الصيغة المخزّنة الأصلية (أقدم سجل) — للتواصل
      duplicateCount: members.length,
      firstAddedAt: members[0].createdAt,
      employees,
      hasBooked: arr.some((l) => BOOKED_STAGES.includes(l.stage)),
      members,
    };
  };

  const all = dupEntries
    .map(([, arr]) => build(arr))
    .sort((a, b) => b.duplicateCount - a.duplicateCount || a.firstAddedAt.getTime() - b.firstAddedAt.getTime());

  return {
    active: all.filter((g) => !g.hasBooked),
    booked: all.filter((g) => g.hasBooked),
  };
}

/**
 * عدّاد خفيف لشارة التنقّل: عدد مجموعات المكررين «النشطة» (count>1 بلا سجل محجوز/مباع).
 * استعلام واحد (phone, stage) + تجميع بالذاكرة. يُستدعى للمدير فقط (التنقّل managerOnly).
 */
export async function activeDuplicateGroupCount(): Promise<number> {
  const leads = await prisma.lead.findMany({ select: { phone: true, stage: true } });
  const byKey = new Map<string, LeadStage[]>();
  for (const l of leads) {
    const k = dedupeKey(l.phone);
    if (!k) continue;
    const arr = byKey.get(k);
    if (arr) arr.push(l.stage);
    else byKey.set(k, [l.stage]);
  }
  let count = 0;
  for (const stages of byKey.values()) {
    if (stages.length > 1 && !stages.some((s) => BOOKED_STAGES.includes(s))) count++;
  }
  return count;
}
