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
import { normalizePurchaseMethod, normalizePurchaseGoal, normalizePhone, phoneVariants } from "@/lib/value-normalize";

export type ImportResult = { ok: boolean; error?: string; created?: number; updated?: number; skipped?: number };

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

// تطبيع رأس العمود: إزالة تشكيل/تطويل + توحيد الألف/الياء/التاء — للمطابقة بالاحتواء.
function normHeader(s: string): string {
  return s
    .replace(/[ـً-ْ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// كلمات مفتاحية لكل حقل — تُطابَق بالاحتواء داخل رأس العمود (مطبّعة).
const HEADER_KEYWORDS: Record<string, string[]> = {
  phone: ["جوال", "هاتف", "تلفون", "موبايل", "رقم", "phone", "mobile", "tel"],
  purchaseMethod: ["طريقه", "طريقة", "تمويل", "كاش", "نقد", "دفع", "method", "payment"],
  purchaseGoal: ["هدف", "غرض", "سكن", "استثمار", "goal", "purpose"],
  channel: ["قناه", "مصدر", "channel", "source"],
  project: ["مشروع", "project"],
  budget: ["ميزانيه", "ميزانية", "budget"],
  district: ["حي", "منطقه", "منطقة", "district", "area"],
  unitType: ["نوع", "وحده", "وحدة", "unit"],
  stage: ["مرحله", "مرحلة", "stage"],
  priority: ["اولويه", "اولوية", "priority"],
  notes: ["ملاحظ", "تعليق", "notes", "note"],
  firstName: ["الاسم الاول", "الاول", "first"],
  lastName: ["الاسم الاخير", "الاخير", "العائله", "last"],
  name: ["اسم", "name"],
};
// ترتيب الفحص: الأكثر تحديدًا أولًا، و«الاسم» أخيرًا (كلمته عامة).
const FIELD_ORDER = [
  "phone", "purchaseMethod", "purchaseGoal", "channel", "project", "budget",
  "district", "unitType", "stage", "priority", "notes", "firstName", "lastName", "name",
];

function matchByHeader(header: string): string | null {
  const h = normHeader(header);
  if (!h) return null;
  for (const field of FIELD_ORDER) {
    if ((HEADER_KEYWORDS[field] ?? []).some((k) => h.includes(normHeader(k)))) return field;
  }
  return null;
}

// رقم جوال سعودي محتمل (بأي صيغة) — لاستشعار عمود الجوال من القيم.
function looksLikePhone(v: string): boolean {
  const d = v.replace(/[^\d]/g, "");
  return /^(00966|966)?0?5\d{8}$/.test(d) || /^5\d{8}$/.test(d);
}

// اسم محتمل: نص فيه حروف (عربي/إنجليزي)، ليس رقمًا ولا جوالًا ولا رموزًا فقط.
function looksLikeName(v: string): boolean {
  if (looksLikePhone(v)) return false;
  if (/^[\d\s+\-()._/]+$/.test(v)) return false; // أرقام/رموز فقط
  return /[A-Za-z؀-ۿ]/.test(v);
}

/**
 * مطابقة مقترحة لكل عمود: أولًا من رأس العمود (احتواء كلمة مفتاحية)،
 * ثم استشعار من القيم لأعمدة الجوال/طريقة/هدف الشراء غير المطابقة.
 * كل حقل يُسنَد لعمود واحد على الأكثر.
 */
function suggestMapping(headers: string[], rows: string[][]): string[] {
  const result: string[] = new Array(headers.length).fill("");
  const taken = new Set<string>();

  headers.forEach((h, i) => {
    const field = matchByHeader(h);
    if (field && !taken.has(field)) { result[i] = field; taken.add(field); }
  });

  const sample = rows.slice(0, 20);
  headers.forEach((_, i) => {
    if (result[i]) return;
    const vals = sample.map((r) => (r[i] ?? "").trim()).filter(Boolean);
    if (vals.length === 0) return;
    const half = Math.ceil(vals.length / 2);
    const hit = (fn: (v: string) => unknown) => vals.filter((v) => fn(v)).length >= half;
    if (!taken.has("phone") && hit(looksLikePhone)) { result[i] = "phone"; taken.add("phone"); return; }
    if (!taken.has("purchaseMethod") && hit(normalizePurchaseMethod)) { result[i] = "purchaseMethod"; taken.add("purchaseMethod"); return; }
    if (!taken.has("purchaseGoal") && hit(normalizePurchaseGoal)) { result[i] = "purchaseGoal"; taken.add("purchaseGoal"); return; }
  });

  // كشف عمود الاسم من القيم: أول عمود غير مطابق قيمه نصوص (عربي/إنجليزي) — غالبًا أول عمود.
  const hasNameField = result.some((f) => f === "name" || f === "firstName" || f === "lastName");
  if (!hasNameField) {
    for (let i = 0; i < headers.length; i++) {
      if (result[i]) continue;
      const vals = sample.map((r) => (r[i] ?? "").trim()).filter(Boolean);
      if (vals.length === 0) continue;
      if (vals.filter(looksLikeName).length >= Math.ceil(vals.length / 2)) { result[i] = "name"; break; }
    }
  }

  return result;
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
    const suggested = suggestMapping(headers, rows);
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
      phone: normalizePhone(rec.phone),
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
    // الجوال يُخزَّن بصيغ مختلفة → طابق عبر كل الصيغ المحتملة ثم وحّدها.
    const allVariants = [...new Set(phones.flatMap((p) => phoneVariants(p)))];
    const existing = await prisma.lead.findMany({ where: { phone: { in: allVariants } }, select: { phone: true } });
    const existingSet = new Set(existing.map((e) => normalizePhone(e.phone)));
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

/**
 * الخطوة ٣: تنفيذ الاستيراد للصفوف «الجديدة».
 * updateExisting = true → يعبّي القيم الفاضية للعملاء الموجودين (نفس الجوال) من بيانات الملف
 * بدون المساس بالقيم المعبّأة أصلًا — مفيد لإصلاح عملاء استُوردوا سابقًا بقيم لم تُطابَق.
 */
export async function commitImport(rows: ImportRow[], assignMode: string, updateExisting = false): Promise<ImportResult> {
  try {
    const me = await requireManager();
    const fresh = rows.filter((r) => r.status === "new");
    const existing = updateExisting ? rows.filter((r) => r.status === "exists") : [];
    if (fresh.length === 0 && existing.length === 0) return { ok: true, created: 0, updated: 0, skipped: rows.length };

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
          purchaseMethod: normalizePurchaseMethod(r.purchaseMethod),
          purchaseGoal: normalizePurchaseGoal(r.purchaseGoal),
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

    // تحديث الموجودين: تعبئة الفاضي فقط من بيانات الملف.
    let updated = 0;
    for (const r of existing) {
      const lead = await prisma.lead.findFirst({
        where: { phone: { in: phoneVariants(r.phone) } },
        select: { id: true, purchaseMethod: true, purchaseGoal: true, budget: true, unitType: true, preferredDistrict: true, projectId: true },
      });
      if (!lead) continue;

      const data: Record<string, unknown> = {};
      const pm = normalizePurchaseMethod(r.purchaseMethod);
      if (pm && !lead.purchaseMethod) data.purchaseMethod = pm;
      const pg = normalizePurchaseGoal(r.purchaseGoal);
      if (pg && !lead.purchaseGoal) data.purchaseGoal = pg;
      if (r.budget && lead.budget == null) data.budget = Number(r.budget);
      if (r.unitType && !lead.unitType) { const ut = unitTypeBy[r.unitType]; if (ut) data.unitType = ut; }
      if (r.district && !lead.preferredDistrict) data.preferredDistrict = r.district;
      if (r.project && !lead.projectId) { const pid = projectByName.get(r.project); if (pid) data.projectId = pid; }

      if (Object.keys(data).length > 0) {
        await prisma.lead.update({ where: { id: lead.id }, data });
        updated++;
      }
    }

    revalidatePath("/admin");
    revalidatePath("/leads");
    return { ok: true, created, updated, skipped: rows.length - created - updated };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
