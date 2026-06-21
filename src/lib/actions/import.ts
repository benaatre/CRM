"use server";

import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { Channel, LeadStage, Priority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth-guards";
import type { ImportRow } from "@/lib/import-meta";
import {
  channelLabels,
  stageLabels,
  priorityLabels,
  unitTypeLabels,
  purchaseMethodLabels,
  purchaseGoalLabels,
} from "@/lib/labels";

export type ImportResult = { ok: boolean; error?: string; created?: number; skipped?: number };

// خرائط عكسية: من القيمة العربية أو اسم enum إلى enum
function reverse<T extends string>(map: Record<T, string>): Record<string, T> {
  const r: Record<string, T> = {};
  for (const key in map) {
    r[map[key as T]] = key as T;
    r[key] = key as T;
  }
  return r;
}
const channelBy = reverse(channelLabels);
const stageBy = reverse(stageLabels);
const priorityBy = reverse(priorityLabels);
const unitTypeBy = reverse(unitTypeLabels);
const purchaseMethodBy = reverse(purchaseMethodLabels);
const purchaseGoalBy = reverse(purchaseGoalLabels);

// مطابقة تلقائية لاسم العمود → حقل النظام
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
  for (const field in HEADERS) {
    if (HEADERS[field].some((s) => s.toLowerCase() === h)) return field;
  }
  return null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === "") continue;
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i];
      if (ch === '"') {
        if (inQ && rawLine[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cells.push(cur); cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    const cells = values.slice(1).map((v) => {
      if (v == null) return "";
      if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text);
      return String(v);
    });
    rows.push(cells);
  });
  return rows;
}

function sheetToCsvUrl(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const gid = (url.match(/[#&]gid=([0-9]+)/) || [])[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

async function rowsFromForm(formData: FormData): Promise<string[][]> {
  const mode = String(formData.get("mode") ?? "file");
  if (mode === "paste") {
    return parseCsv(String(formData.get("text") ?? "").replace(/\t/g, ","));
  }
  if (mode === "sheet") {
    const csvUrl = sheetToCsvUrl(String(formData.get("sheetUrl") ?? ""));
    if (!csvUrl) throw new Error("رابط شيت غير صالح");
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error("ما قدرت أقرأ الشيت — تأكد إنه عام (Anyone with link)");
    return parseCsv(await res.text());
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("اختر ملفًا");
  const buf = await file.arrayBuffer();
  return /\.xlsx?$/i.test(file.name) ? parseXlsx(buf) : parseCsv(new TextDecoder("utf-8").decode(buf));
}

/** الخطوة ١: قراءة الملف وإرجاع العناوين + الصفوف + مطابقة مقترحة لكل عمود. */
export async function readSheet(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; headers?: string[]; rows?: string[][]; suggested?: string[] }> {
  try {
    await requireManager();
    const raw = await rowsFromForm(formData);
    if (raw.length < 1) return { ok: false, error: "الملف فاضي" };
    const headers = raw[0];
    const rows = raw.slice(1);
    const suggested = headers.map((h) => matchField(h) ?? "");
    return { ok: true, headers, rows, suggested };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function buildRecords(rows: string[][], mapping: Record<string, string>): Omit<ImportRow, "status">[] {
  return rows.map((row) => {
    const rec: Record<string, string> = {};
    for (const [idx, field] of Object.entries(mapping)) {
      if (field) rec[field] = (row[Number(idx)] ?? "").trim();
    }
    let name = (rec.name ?? "").trim();
    if (!name && (rec.firstName || rec.lastName)) {
      name = `${rec.firstName ?? ""} ${rec.lastName ?? ""}`.trim();
    }
    return {
      name,
      phone: (rec.phone ?? "").replace(/[^\d]/g, ""),
      channel: rec.channel,
      project: rec.project,
      budget: rec.budget?.replace(/[^\d]/g, ""),
      purchaseMethod: rec.purchaseMethod,
      purchaseGoal: rec.purchaseGoal,
      district: rec.district,
      unitType: rec.unitType,
      stage: rec.stage,
      priority: rec.priority,
      notes: rec.notes,
    };
  });
}

/** الخطوة ٢: تطبيق المطابقة وحساب حالة كل صف (جديد/مكرر/موجود/غير صالح). */
export async function previewMapped(
  rows: string[][],
  mapping: Record<string, string>,
): Promise<{ ok: boolean; error?: string; rows?: ImportRow[] }> {
  try {
    await requireManager();
    const fields = Object.values(mapping);
    const hasName = fields.includes("name") || (fields.includes("firstName") || fields.includes("lastName"));
    if (!hasName || !fields.includes("phone")) {
      return { ok: false, error: "لازم تطابق «الاسم» (أو الأول+الأخير) و«الجوال»" };
    }
    const records = buildRecords(rows, mapping);
    const phones = records.map((r) => r.phone).filter(Boolean);
    const existing = await prisma.lead.findMany({ where: { phone: { in: phones } }, select: { phone: true } });
    const existingSet = new Set(existing.map((e) => e.phone));
    const seen = new Set<string>();

    const out: ImportRow[] = records.map((r) => {
      let status: ImportRow["status"];
      if (!r.name || !/^\d{9,12}$/.test(r.phone)) status = "invalid";
      else if (existingSet.has(r.phone)) status = "exists";
      else if (seen.has(r.phone)) status = "duplicate";
      else { seen.add(r.phone); status = "new"; }
      return { ...r, status };
    });
    return { ok: true, rows: out };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** الخطوة ٣: تنفيذ الاستيراد للصفوف «الجديدة» فقط. يتجنّب التكرار (نفس الجوال). */
export async function commitImport(rows: ImportRow[], assignMode: string): Promise<ImportResult> {
  try {
    const me = await requireManager();
    const fresh = rows.filter((r) => r.status === "new");
    if (fresh.length === 0) return { ok: true, created: 0, skipped: rows.length };

    const employees =
      assignMode === "roundrobin"
        ? await prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true } })
        : [];
    const projects = await prisma.project.findMany({ select: { id: true, name: true } });
    const projectByName = new Map(projects.map((p) => [p.name.trim(), p.id]));

    let created = 0;
    let rr = 0;
    for (const r of fresh) {
      let assignedToId: string | null = me.id;
      if (assignMode === "roundrobin" && employees.length > 0) { assignedToId = employees[rr % employees.length].id; rr++; }
      else if (assignMode !== "self" && assignMode !== "roundrobin") assignedToId = assignMode;

      await prisma.lead.create({
        data: {
          name: r.name,
          phone: r.phone,
          channel: (r.channel && channelBy[r.channel]) || Channel.OTHER,
          stage: (r.stage && stageBy[r.stage]) || LeadStage.NEW,
          priority: (r.priority && priorityBy[r.priority]) || Priority.MEDIUM,
          unitType: r.unitType ? unitTypeBy[r.unitType] ?? null : null,
          budget: r.budget ? Number(r.budget) : null,
          purchaseMethod: r.purchaseMethod ? purchaseMethodBy[r.purchaseMethod] ?? null : null,
          purchaseGoal: r.purchaseGoal ? purchaseGoalBy[r.purchaseGoal] ?? null : null,
          preferredDistrict: r.district || null,
          notes: r.notes || null,
          projectId: r.project ? projectByName.get(r.project) ?? null : null,
          assignedToId,
          createdById: me.id,
          nextFollowup: new Date(Date.now() + 86_400_000),
        },
      });
      created++;
    }
    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, created, skipped: rows.length - created };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
