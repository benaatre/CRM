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
} from "@/lib/labels";

export type ImportResult = {
  ok: boolean;
  error?: string;
  created?: number;
  skipped?: number;
};

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

const HEADERS: Record<string, string[]> = {
  name: ["الاسم", "الإسم", "اسم", "name"],
  phone: ["الجوال", "الجوّال", "الهاتف", "جوال", "phone", "mobile"],
  channel: ["القناة", "قناة", "المصدر", "channel"],
  project: ["المشروع", "مشروع", "project"],
  unitType: ["نوع الوحدة", "الوحدة", "unit", "unittype"],
  budget: ["الميزانية", "ميزانية", "budget"],
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
    const text = String(formData.get("text") ?? "");
    return parseCsv(text.replace(/\t/g, ","));
  }
  if (mode === "sheet") {
    const url = String(formData.get("sheetUrl") ?? "");
    const csvUrl = sheetToCsvUrl(url);
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

function mapRows(rows: string[][]): { records: Omit<ImportRow, "status">[]; ok: boolean } {
  if (rows.length < 2) return { records: [], ok: false };
  const header = rows[0];
  const colMap: Record<number, string> = {};
  header.forEach((h, i) => {
    const f = matchField(h);
    if (f) colMap[i] = f;
  });
  const fields = Object.values(colMap);
  if (!fields.includes("name") || !fields.includes("phone")) return { records: [], ok: false };

  const records = rows.slice(1).map((row) => {
    const rec: Record<string, string> = {};
    row.forEach((v, i) => { if (colMap[i]) rec[colMap[i]] = v; });
    return {
      name: (rec.name ?? "").trim(),
      phone: (rec.phone ?? "").replace(/[^\d]/g, ""),
      channel: rec.channel?.trim(),
      project: rec.project?.trim(),
      unitType: rec.unitType?.trim(),
      budget: rec.budget?.replace(/[^\d]/g, ""),
      stage: rec.stage?.trim(),
      priority: rec.priority?.trim(),
      notes: rec.notes?.trim(),
    };
  });
  return { records, ok: true };
}

/** معاينة الاستيراد: يرجّع الصفوف مع حالة كل واحد (جديد/مكرر/موجود). */
export async function parseImport(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; rows?: ImportRow[] }> {
  try {
    await requireManager();
    const raw = await rowsFromForm(formData);
    const { records, ok } = mapRows(raw);
    if (!ok) return { ok: false, error: "لازم الملف يحتوي عمودي «الاسم» و«الجوال»" };

    const phones = records.map((r) => r.phone).filter(Boolean);
    const existing = await prisma.lead.findMany({ where: { phone: { in: phones } }, select: { phone: true } });
    const existingSet = new Set(existing.map((e) => e.phone));
    const seen = new Set<string>();

    const rows: ImportRow[] = records.map((r) => {
      let status: ImportRow["status"];
      if (!r.name || !/^\d{9,12}$/.test(r.phone)) status = "invalid";
      else if (existingSet.has(r.phone)) status = "exists";
      else if (seen.has(r.phone)) status = "duplicate";
      else { seen.add(r.phone); status = "new"; }
      return { ...r, status };
    });
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** تنفيذ الاستيراد: ينشئ الصفوف «الجديدة» فقط. */
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

export async function importLeads(formData: FormData): Promise<ImportResult> {
  try {
    const me = await requireManager();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0)
      return { ok: false, error: "اختر ملف CSV أو Excel" };

    const assignMode = String(formData.get("assignMode") ?? "self"); // self | roundrobin | <employeeId>

    const buf = await file.arrayBuffer();
    const isExcel = /\.xlsx?$/i.test(file.name);
    const rows = isExcel
      ? await parseXlsx(buf)
      : parseCsv(new TextDecoder("utf-8").decode(buf));

    if (rows.length < 2) return { ok: false, error: "الملف فاضي أو ما فيه صفوف" };

    // الصف الأول = العناوين
    const headerRow = rows[0];
    const colMap: Record<number, string> = {};
    headerRow.forEach((h, i) => {
      const field = matchField(h);
      if (field) colMap[i] = field;
    });
    const hasName = Object.values(colMap).includes("name");
    const hasPhone = Object.values(colMap).includes("phone");
    if (!hasName || !hasPhone)
      return { ok: false, error: "لازم الملف يحتوي عمودي «الاسم» و«الجوال»" };

    // تجهيز الإسناد
    const employees =
      assignMode === "roundrobin"
        ? await prisma.user.findMany({ where: { role: "EMPLOYEE", active: true }, select: { id: true } })
        : [];
    const projects = await prisma.project.findMany({ select: { id: true, name: true } });
    const projectByName = new Map(projects.map((p) => [p.name.trim(), p.id]));

    let created = 0;
    let skipped = 0;
    let rr = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const rec: Record<string, string> = {};
      row.forEach((val, i) => {
        if (colMap[i]) rec[colMap[i]] = val;
      });

      const name = (rec.name ?? "").trim();
      const phone = (rec.phone ?? "").replace(/[^\d]/g, "");
      if (!name || !/^\d{9,12}$/.test(phone)) {
        skipped++;
        continue;
      }

      let assignedToId: string | null = me.id;
      if (assignMode === "roundrobin" && employees.length > 0) {
        assignedToId = employees[rr % employees.length].id;
        rr++;
      } else if (assignMode !== "self" && assignMode !== "roundrobin") {
        assignedToId = assignMode; // معرّف موظف محدّد
      }

      const budget = (rec.budget ?? "").replace(/[^\d]/g, "");

      await prisma.lead.create({
        data: {
          name,
          phone,
          channel: (rec.channel && channelBy[rec.channel.trim()]) || Channel.OTHER,
          stage: (rec.stage && stageBy[rec.stage.trim()]) || LeadStage.NEW,
          priority: (rec.priority && priorityBy[rec.priority.trim()]) || Priority.MEDIUM,
          unitType: rec.unitType ? unitTypeBy[rec.unitType.trim()] ?? null : null,
          budget: budget ? Number(budget) : null,
          notes: (rec.notes ?? "").trim() || null,
          projectId: rec.project ? projectByName.get(rec.project.trim()) ?? null : null,
          assignedToId,
          createdById: me.id,
          nextFollowup: new Date(Date.now() + 86_400_000),
        },
      });
      created++;
    }

    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, created, skipped };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
