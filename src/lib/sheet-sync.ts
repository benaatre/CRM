import "server-only";

import { prisma } from "@/lib/prisma";
import {
  channelLabels, stageLabels, priorityLabels, unitTypeLabels,
  purchaseMethodLabels, purchaseGoalLabels,
} from "@/lib/labels";

// ===== أدوات CSV ومطابقة (مكتفية ذاتيًا لتشتغل خارج سياق "use server") =====

function reverse<T extends string>(map: Record<T, string>): Record<string, T> {
  const r: Record<string, T> = {};
  for (const key in map) { r[map[key as T]] = key as T; r[key] = key as T; }
  return r;
}
const channelBy = reverse(channelLabels);
const stageBy = reverse(stageLabels);
const priorityBy = reverse(priorityLabels);
const unitTypeBy = reverse(unitTypeLabels);
const purchaseMethodBy = reverse(purchaseMethodLabels);
const purchaseGoalBy = reverse(purchaseGoalLabels);

const HEADERS: Record<string, string[]> = {
  name: ["الاسم", "الإسم", "اسم", "الاسم الكامل", "name", "full name", "fullname"],
  firstName: ["الاسم الأول", "الاسم الاول", "first name", "firstname", "first"],
  lastName: ["الاسم الأخير", "الاسم الاخير", "العائلة", "last name", "lastname", "last"],
  phone: ["الجوال", "الجوّال", "الهاتف", "جوال", "رقم الجوال", "phone", "mobile", "phone number"],
  channel: ["القناة", "قناة", "المصدر", "channel", "source"],
  project: ["المشروع", "مشروع", "project"],
  budget: ["الميزانية", "ميزانية", "budget"],
  purchaseMethod: ["طريقة الشراء", "طريقة الدفع", "purchase method"],
  purchaseGoal: ["هدف الشراء", "الهدف", "purchase goal"],
  district: ["الحي", "الحي المفضل", "المنطقة", "district", "area"],
  unitType: ["نوع الوحدة", "الوحدة", "unit", "unittype"],
  stage: ["المرحلة", "مرحلة", "stage"],
  priority: ["الأولوية", "أولوية", "priority"],
  notes: ["ملاحظات", "ملاحظة", "notes"],
};
function matchField(header: string): string | null {
  const h = header.trim().toLowerCase();
  for (const field in HEADERS) if (HEADERS[field].some((s) => s.toLowerCase() === h)) return field;
  return null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === "") continue;
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i];
      if (ch === '"') { if (inQ && rawLine[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

function sheetToCsvUrl(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const gid = (url.match(/[#&]gid=([0-9]+)/) || [])[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

export type SyncResult = { ok: boolean; created?: number; error?: string };

/**
 * يسحب الليدات الجديدة من جوجل شيت المُهيّأ في الإعدادات وينشئها (يتجاهل المكرر بالجوال).
 * بدون مصادقة — للاستدعاء من زر (بعد التحقق) أو من cron (بسرّ).
 */
export async function runSheetSync(): Promise<SyncResult> {
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
    select: { googleSheetUrl: true, autoAssign: true },
  });
  if (!settings?.googleSheetUrl) return { ok: false, error: "ما فيه رابط شيت في الإعدادات" };

  const csvUrl = sheetToCsvUrl(settings.googleSheetUrl);
  if (!csvUrl) return { ok: false, error: "رابط شيت غير صالح" };

  let raw: string[][];
  try {
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "تعذّر قراءة الشيت — تأكد إنه عام" };
    raw = parseCsv(await res.text());
  } catch {
    return { ok: false, error: "تعذّر الاتصال بالشيت" };
  }
  if (raw.length < 2) {
    await prisma.settings.update({ where: { id: "singleton" }, data: { lastSyncAt: new Date() } });
    return { ok: true, created: 0 };
  }

  // مطابقة تلقائية + بناء السجلات
  const mapping: Record<number, string> = {};
  raw[0].forEach((h, i) => { const f = matchField(h); if (f) mapping[i] = f; });

  const records = raw.slice(1).map((row) => {
    const rec: Record<string, string> = {};
    for (const [idx, field] of Object.entries(mapping)) rec[field] = (row[Number(idx)] ?? "").trim();
    let name = (rec.name ?? "").trim();
    if (!name && (rec.firstName || rec.lastName)) name = `${rec.firstName ?? ""} ${rec.lastName ?? ""}`.trim();
    return {
      name,
      phone: (rec.phone ?? "").replace(/[^\d]/g, ""),
      channel: rec.channel, project: rec.project, budget: (rec.budget ?? "").replace(/[^\d]/g, ""),
      purchaseMethod: rec.purchaseMethod, purchaseGoal: rec.purchaseGoal, district: rec.district,
      unitType: rec.unitType, stage: rec.stage, priority: rec.priority, notes: rec.notes,
    };
  });

  const phones = records.map((r) => r.phone).filter(Boolean);
  const existing = await prisma.lead.findMany({ where: { phone: { in: phones } }, select: { phone: true } });
  const existingSet = new Set(existing.map((e) => e.phone));
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  const projectByName = new Map(projects.map((p) => [p.name.trim(), p.id]));

  // إسناد تلقائي للأقل حملًا (إن مُفعّل)
  const emps = settings.autoAssign
    ? await prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true, _count: { select: { assignedLeads: true } } } })
    : [];
  const load = new Map(emps.map((e) => [e.id, e._count.assignedLeads]));

  const seen = new Set<string>();
  let created = 0;
  for (const r of records) {
    if (!r.name || !/^\d{9,12}$/.test(r.phone)) continue;
    if (existingSet.has(r.phone) || seen.has(r.phone)) continue;
    seen.add(r.phone);

    let assignedToId: string | null = null;
    if (settings.autoAssign && emps.length > 0) {
      const best = [...load.entries()].sort((a, b) => a[1] - b[1])[0];
      assignedToId = best[0];
      load.set(best[0], best[1] + 1);
    }

    await prisma.lead.create({
      data: {
        name: r.name,
        phone: r.phone,
        channel: (r.channel && channelBy[r.channel]) || "OTHER",
        stage: (r.stage && stageBy[r.stage]) || "NEW",
        priority: (r.priority && priorityBy[r.priority]) || "MEDIUM",
        unitType: r.unitType ? unitTypeBy[r.unitType] ?? null : null,
        budget: r.budget ? Number(r.budget) : null,
        purchaseMethod: r.purchaseMethod ? purchaseMethodBy[r.purchaseMethod] ?? null : null,
        purchaseGoal: r.purchaseGoal ? purchaseGoalBy[r.purchaseGoal] ?? null : null,
        preferredDistrict: r.district || null,
        notes: r.notes || null,
        projectId: r.project ? projectByName.get(r.project) ?? null : null,
        assignedToId,
        nextFollowup: new Date(Date.now() + 86_400_000),
      },
    });
    created++;
  }

  await prisma.settings.update({ where: { id: "singleton" }, data: { lastSyncAt: new Date() } });
  return { ok: true, created };
}
