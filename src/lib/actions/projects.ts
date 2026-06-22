"use server";

import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { ProjectStatus, UnitType, UnitStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";
import { unitTypeLabels, unitStatusLabels } from "@/lib/labels";

export type Result = { ok: boolean; error?: string };

const num = (fd: FormData, key: string): number | null => {
  const v = String(fd.get(key) ?? "").replace(/[^\d.]/g, "");
  return v ? Number(v) : null;
};
const str = (fd: FormData, key: string): string | null => String(fd.get(key) ?? "").trim() || null;

// ===================== المشاريع =====================

export async function createProject(formData: FormData): Promise<Result> {
  try {
    const user = await requireManager();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "اكتب اسم المشروع" };
    const dateRaw = String(formData.get("deliveryDate") ?? "");
    const p = await prisma.project.create({
      data: {
        name,
        district: str(formData, "district"),
        description: str(formData, "description"),
        status: (String(formData.get("status") ?? "AVAILABLE") as ProjectStatus),
        priceMin: num(formData, "priceMin"),
        priceMax: num(formData, "priceMax"),
        maxDiscountPercent: num(formData, "maxDiscountPercent"),
        maxDiscountAmount: num(formData, "maxDiscountAmount"),
        deliveryDate: dateRaw ? new Date(dateRaw) : null,
        falLicense: str(formData, "falLicense"),
      },
    });
    await logAudit(prisma, { userId: user.id, action: "project.created", entity: "project", entityId: p.id, summary: `أضاف مشروع ${name}` });
    revalidatePath("/projects");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateProject(projectId: string, formData: FormData): Promise<Result> {
  try {
    await requireManager();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "اكتب اسم المشروع" };
    const dateRaw = String(formData.get("deliveryDate") ?? "");
    await prisma.project.update({
      where: { id: projectId },
      data: {
        name,
        district: str(formData, "district"),
        description: str(formData, "description"),
        status: (String(formData.get("status") ?? "AVAILABLE") as ProjectStatus),
        priceMin: num(formData, "priceMin"),
        priceMax: num(formData, "priceMax"),
        maxDiscountPercent: num(formData, "maxDiscountPercent"),
        maxDiscountAmount: num(formData, "maxDiscountAmount"),
        deliveryDate: dateRaw ? new Date(dateRaw) : null,
        falLicense: str(formData, "falLicense"),
      },
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ===================== الوحدات =====================

export async function createUnit(projectId: string, formData: FormData): Promise<Result> {
  try {
    await requireManager();
    const number = String(formData.get("number") ?? "").trim();
    if (!number) return { ok: false, error: "اكتب رقم الوحدة" };
    await prisma.unit.create({
      data: {
        projectId,
        number,
        type: (String(formData.get("type") ?? "APARTMENT") as UnitType),
        floor: str(formData, "floor"),
        area: num(formData, "area"),
        price: num(formData, "price"),
        status: (String(formData.get("status") ?? "AVAILABLE") as UnitStatus),
        discountPercent: num(formData, "discountPercent"),
        notes: str(formData, "notes"),
      },
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/projects");
    return { ok: true };
  } catch (e) {
    const msg = (e as { code?: string }).code === "P2002" ? "رقم الوحدة مكرّر في هذا المشروع" : (e as Error).message;
    return { ok: false, error: msg };
  }
}

export async function updateUnit(unitId: string, formData: FormData): Promise<Result> {
  try {
    await requireManager();
    const number = String(formData.get("number") ?? "").trim();
    if (!number) return { ok: false, error: "اكتب رقم الوحدة" };
    const unit = await prisma.unit.update({
      where: { id: unitId },
      data: {
        number,
        type: (String(formData.get("type") ?? "APARTMENT") as UnitType),
        floor: str(formData, "floor"),
        area: num(formData, "area"),
        price: num(formData, "price"),
        status: (String(formData.get("status") ?? "AVAILABLE") as UnitStatus),
        discountPercent: num(formData, "discountPercent"),
        notes: str(formData, "notes"),
      },
      select: { projectId: true },
    });
    revalidatePath(`/projects/${unit.projectId}`);
    return { ok: true };
  } catch (e) {
    const msg = (e as { code?: string }).code === "P2002" ? "رقم الوحدة مكرّر" : (e as Error).message;
    return { ok: false, error: msg };
  }
}

export async function deleteUnit(unitId: string): Promise<Result> {
  try {
    await requireManager();
    const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { projectId: true, booking: { select: { id: true } } } });
    if (!unit) return { ok: false, error: "الوحدة غير موجودة" };
    if (unit.booking) return { ok: false, error: "الوحدة عليها حجز — ألغِ الحجز أول" };
    await prisma.unit.delete({ where: { id: unitId } });
    revalidatePath(`/projects/${unit.projectId}`);
    revalidatePath("/projects");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ===================== رفع الوحدات من Excel/CSV =====================

function reverse<T extends string>(map: Record<T, string>): Record<string, T> {
  const r: Record<string, T> = {};
  for (const k in map) { r[map[k as T]] = k as T; r[k] = k as T; }
  return r;
}
const unitTypeBy = reverse(unitTypeLabels);
const unitStatusBy = reverse(unitStatusLabels);

const U_HEADERS: Record<string, string[]> = {
  number: ["رقم الوحدة", "رقم", "الوحدة", "number", "unit", "no"],
  type: ["النوع", "نوع الوحدة", "type"],
  floor: ["الدور", "دور", "floor"],
  area: ["المساحة", "مساحة", "area"],
  price: ["السعر", "سعر", "price"],
  status: ["الحالة", "حالة", "status"],
};
function matchUnitField(h: string): string | null {
  const x = h.trim().toLowerCase();
  for (const f in U_HEADERS) if (U_HEADERS[f].some((s) => s.toLowerCase() === x)) return f;
  return null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
      else cur += ch;
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
    rows.push(values.slice(1).map((v) => v == null ? "" : (typeof v === "object" && "text" in v ? String((v as { text: unknown }).text) : String(v))));
  });
  return rows;
}

export type UnitImportRow = {
  number: string; type?: string; floor?: string; area?: string; price?: string; status?: string;
  exists: boolean;
};

export async function parseUnitsSheet(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; rows?: UnitImportRow[] }> {
  try {
    await requireManager();
    const projectId = String(formData.get("projectId") ?? "");
    const mode = String(formData.get("mode") ?? "file");
    let raw: string[][];
    if (mode === "paste") raw = parseCsv(String(formData.get("text") ?? "").replace(/\t/g, ","));
    else {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return { ok: false, error: "اختر ملفًا" };
      const buf = await file.arrayBuffer();
      raw = /\.xlsx?$/i.test(file.name) ? await parseXlsx(buf) : parseCsv(new TextDecoder("utf-8").decode(buf));
    }
    if (raw.length < 2) return { ok: false, error: "الملف فاضي" };
    const colMap: Record<number, string> = {};
    raw[0].forEach((h, i) => { const f = matchUnitField(h); if (f) colMap[i] = f; });
    if (!Object.values(colMap).includes("number")) return { ok: false, error: "لازم عمود «رقم الوحدة»" };

    const existing = await prisma.unit.findMany({ where: { projectId }, select: { number: true } });
    const existingSet = new Set(existing.map((u) => u.number));

    const rows: UnitImportRow[] = raw.slice(1).map((row) => {
      const rec: Record<string, string> = {};
      row.forEach((v, i) => { if (colMap[i]) rec[colMap[i]] = v.trim(); });
      return {
        number: rec.number ?? "", type: rec.type, floor: rec.floor,
        area: rec.area?.replace(/[^\d.]/g, ""), price: rec.price?.replace(/[^\d]/g, ""), status: rec.status,
        exists: !!rec.number && existingSet.has(rec.number),
      };
    }).filter((r) => r.number);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function commitUnits(
  projectId: string, rows: UnitImportRow[], updateExisting: boolean,
): Promise<{ ok: boolean; error?: string; created?: number; updated?: number; skipped?: number }> {
  try {
    await requireManager();
    let created = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (!r.number) { skipped++; continue; }
      const data = {
        type: r.type ? unitTypeBy[r.type] ?? UnitType.APARTMENT : UnitType.APARTMENT,
        floor: r.floor || null,
        area: r.area ? Number(r.area) : null,
        price: r.price ? Number(r.price) : null,
        status: r.status ? unitStatusBy[r.status] ?? UnitStatus.AVAILABLE : UnitStatus.AVAILABLE,
      };
      if (r.exists) {
        if (!updateExisting) { skipped++; continue; }
        await prisma.unit.update({ where: { projectId_number: { projectId, number: r.number } }, data });
        updated++;
      } else {
        await prisma.unit.create({ data: { projectId, number: r.number, ...data } });
        created++;
      }
    }
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/projects");
    return { ok: true, created, updated, skipped };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
