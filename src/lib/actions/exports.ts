"use server";

import type { Channel, LeadStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth-guards";
import { dedupeKey } from "@/lib/phone-dupe";
import { bookingCollection } from "@/lib/booking-finance";
import {
  channelLabel, stageLabels, bookingStageLabels, paymentMethodLabels, bankLabels,
  nationalityLabels, purchaseMethodLabels, purchaseGoalLabels, followUpResultLabels,
} from "@/lib/labels";
import { INTEREST_UMBRELLA } from "@/lib/lead-filters";
import { logAudit } from "@/lib/audit";
import {
  BOOKING_SLICES, SLICE_META, columnsOf, familyOf, groupKeys,
  type ExportFilters, type ExportSlice,
} from "@/lib/export-columns";

/**
 * «مركز التصدير» — الأكشن الموحد buildExport (المالك حصرًا، server-side):
 * يعمّم منطق buildAdExclusion القائم (الاستبعاد الإعلاني شريحته الأولى بنفس
 * قواعده حرفيًا — ‏CLOSED_LOST بكل أسبابه، استثناء الموعد المستقبلي إجباريًا،
 * الجوال دوليًا عبر dedupeKey). قراءة تجميعية خالصة — صفر كتابة، صفر schema —
 * وسطر تدقيق exports.download عند التنزيل الفعلي فقط.
 */

export type ExportMode = "count" | "preview" | "csv";

export type ExportResult =
  | {
      ok: true;
      count: number;
      skippedInvalidPhone: number;
      /** preview: رؤوس الأعمدة بالعربي + أول ٥ صفوف. */
      headersAr?: string[];
      sample?: string[][];
      /** csv: الملف واسمه. */
      csv?: string;
      filename?: string;
    }
  | { ok: false; error: string };

const DAY_MS = 86_400_000;
const MONTH_DAYS: Record<3 | 6 | 12, number> = { 3: 90, 6: 180, 12: 365 };
const VISITED_RESULTS = ["INTERESTED_VISITED", "NOT_INTERESTED_VISITED"] as const;

function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/** فلاتر الشريحة بعد فرض قواعدها الإلزامية (الاستبعاد: المواعيد المستقبلية خارجه دائمًا). */
function effectiveFilters(slice: ExportSlice, f: ExportFilters): Required<Pick<ExportFilters, "months" | "includeArchived" | "excludeFutureNext">> & ExportFilters {
  return {
    ...f,
    months: f.months ?? 0,
    includeArchived: f.includeArchived ?? true,
    excludeFutureNext: slice === "ad_exclusion" ? true : (f.excludeFutureNext ?? false),
  };
}

/** وصف الفلاتر نصًا — لسطر التدقيق. */
function filtersText(slice: ExportSlice, f: ReturnType<typeof effectiveFilters>): string {
  const parts: string[] = [SLICE_META[slice].title];
  if (slice === "custom" && f.stages?.length) parts.push(`مراحل: ${f.stages.map((s) => stageLabels[s]).join("/")}`);
  if (f.channels?.length) parts.push(`مصادر: ${f.channels.map((c) => channelLabel(c)).join("/")}`);
  if (f.employeeId) parts.push("موظف محدد");
  parts.push(f.months === 0 ? "المدة: الكل" : `المدة: آخر ${f.months} أشهر`);
  if (!BOOKING_SLICES.includes(slice)) parts.push(`المؤرشفون: ${f.includeArchived ? "نعم" : "لا"}`);
  if (f.excludeFutureNext) parts.push("بلا مواعيد مستقبلية");
  return parts.join(" · ");
}

export async function buildExport(
  slice: ExportSlice,
  rawFilters: ExportFilters,
  columns: { group: "ads" | "basic" | "full" | "manual"; manual?: string[] },
  mode: ExportMode,
): Promise<ExportResult> {
  try {
    const user = await requireUser();
    if (user.role !== "OWNER") return { ok: false, error: "مركز التصدير للمالك فقط" };

    const f = effectiveFilters(slice, rawFilters);
    const family = familyOf(slice);
    const defs = columnsOf(family);
    const keys = columns.group === "manual"
      ? defs.map((d) => d.key).filter((k) => columns.manual?.includes(k)) // بترتيب السجل لا ترتيب التشيك
      : groupKeys(columns.group, family);
    if (keys.length === 0) return { ok: false, error: "اختر عمودًا واحدًا على الأقل" };
    const chosen = defs.filter((d) => keys.includes(d.key));
    const cutoff = f.months !== 0 ? new Date(Date.now() - MONTH_DAYS[f.months] * DAY_MS) : null;

    let skippedInvalidPhone = 0;
    const rows: string[][] = [];

    if (family === "booking") {
      // ===== شرائح الحجوزات/الصفقات =====
      const where: Prisma.BookingWhereInput = {
        stage: slice === "sales" ? { in: ["SOLD", "DELIVERED"] } : { notIn: ["SOLD", "DELIVERED"] },
        ...(f.employeeId ? { sellerId: f.employeeId } : {}),
        ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      };
      const bookings = await prisma.booking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          lead: { select: { name: true, phone: true } },
          unit: { select: { number: true, project: { select: { name: true } } } },
          seller: { select: { name: true } },
        },
      });
      for (const b of bookings) {
        const key = dedupeKey(b.phone ?? b.lead.phone);
        if (!key) { skippedInvalidPhone++; continue; }
        const c = bookingCollection(b.stage, b.finalPrice.toNumber(), b.collectedAmount.toNumber());
        const val: Record<string, string> = {
          phone: `+966${key}`,
          client_name: b.lead.name,
          unit: b.unit.number,
          project: b.unit.project?.name ?? "",
          payment_method: paymentMethodLabels[b.paymentMethod],
          bank: b.bankName ? bankLabels[b.bankName] : "",
          deposit: b.deposit ? String(b.deposit.toNumber()) : "",
          price: String(b.price.toNumber()),
          discount: String(b.discount.toNumber()),
          final_price: String(b.finalPrice.toNumber()),
          collected: String(c.collected),
          remaining: String(c.remaining),
          stage: bookingStageLabels[b.stage],
          seller: b.seller?.name ?? "",
          created_at: day(b.createdAt),
        };
        rows.push(chosen.map((d) => val[d.key] ?? ""));
      }
    } else {
      // ===== شرائح العملاء =====
      const stageWhere: Prisma.LeadWhereInput =
        slice === "ad_exclusion" ? { stage: "CLOSED_LOST" }
        : slice === "interested" ? { stage: { in: INTEREST_UMBRELLA } }
        : slice === "custom" && f.stages?.length ? { stage: { in: f.stages as LeadStage[] } }
        : {}; // all / visited / custom بلا مراحل
      const leads = await prisma.lead.findMany({
        where: {
          ...stageWhere,
          ...(f.channels?.length ? { channel: { in: f.channels as Channel[] } } : {}),
          ...(f.employeeId ? { assignedToId: f.employeeId } : {}),
          ...(f.includeArchived ? {} : { isArchived: false }),
          // نافذة الاستبعاد على الإقفال (updatedAt — العرف القائم)، والبقية على الإنشاء.
          ...(cutoff ? (slice === "ad_exclusion" ? { updatedAt: { gte: cutoff } } : { createdAt: { gte: cutoff } }) : {}),
        },
        select: {
          id: true, name: true, phone: true, channel: true, source: true, stage: true,
          budget: true, purchaseMethod: true, purchaseGoal: true, nationality: true,
          createdAt: true, lastContact: true, updatedAt: true, nextFollowup: true,
          assignedTo: { select: { name: true } },
          project: { select: { name: true } },
          leadSource: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
      });

      // أحدث متابعة + آخر زيارة لكل عميل — استعلام واحد (أول ظهور = الأحدث).
      const ids = leads.map((l) => l.id);
      const fus = ids.length
        ? await prisma.followUp.findMany({
            where: { leadId: { in: ids } },
            orderBy: { createdAt: "desc" },
            select: { leadId: true, result: true, nextDate: true, createdAt: true },
          })
        : [];
      const latest = new Map<string, { result: string; nextDate: Date | null }>();
      const lastVisit = new Map<string, Date>();
      for (const fu of fus) {
        if (!latest.has(fu.leadId)) latest.set(fu.leadId, fu);
        if (!lastVisit.has(fu.leadId) && (VISITED_RESULTS as readonly string[]).includes(fu.result)) lastVisit.set(fu.leadId, fu.createdAt);
      }

      const now = Date.now();
      for (const l of leads) {
        if (slice === "visited" && !lastVisit.has(l.id)) continue; // زيارات تمت: من زار فقط
        const last = latest.get(l.id);
        // الاستثناء: موعد مستقبلي حي بأحدث متابعاته (نفس قاعدة الاستبعاد القائمة).
        if (f.excludeFutureNext && last?.nextDate && last.nextDate.getTime() > now) continue;
        const key = dedupeKey(l.phone);
        if (!key) { skippedInvalidPhone++; continue; }
        const val: Record<string, string> = {
          phone: `+966${key}`,
          name: l.name,
          channel: channelLabel(l.channel),
          source: l.leadSource?.name ?? l.source ?? "",
          stage: stageLabels[l.stage],
          not_interested_reason: last?.result?.startsWith("NOT_INTERESTED")
            ? ((followUpResultLabels as Record<string, string>)[last.result] ?? last.result)
            : "",
          employee: l.assignedTo?.name ?? "",
          created_at: day(l.createdAt),
          last_contact: day(l.lastContact),
          closed_at: l.stage === "CLOSED_LOST" || l.stage === "CLOSED_WON" ? day(l.updatedAt) : "",
          next_followup: day(l.nextFollowup),
          visit_date: day(lastVisit.get(l.id) ?? null),
          project: l.project?.name ?? "",
          budget: l.budget ? String(l.budget.toNumber()) : "",
          purchase_method: l.purchaseMethod ? purchaseMethodLabels[l.purchaseMethod] : "",
          purchase_goal: l.purchaseGoal ? purchaseGoalLabels[l.purchaseGoal] : "",
          nationality: l.nationality ? nationalityLabels[l.nationality] : "",
        };
        rows.push(chosen.map((d) => val[d.key] ?? ""));
      }
    }

    if (mode === "count") return { ok: true, count: rows.length, skippedInvalidPhone };
    if (mode === "preview") {
      return {
        ok: true, count: rows.length, skippedInvalidPhone,
        headersAr: chosen.map((d) => d.label),
        sample: rows.slice(0, 5),
      };
    }

    const csv = [chosen.map((d) => d.header).join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\r\n");
    const filename = `export-${slice}-${new Date().toISOString().slice(0, 10)}.csv`;
    // سطر التدقيق الواحد — عند التنزيل الفعلي فقط، وفشله لا يُفشِل التصدير.
    await logAudit(prisma, {
      userId: user.id,
      action: "exports.download",
      entity: "lead",
      entityId: `export:${slice}`,
      summary: `مركز التصدير: نزّل ${rows.length} صفًا — ${filtersText(slice, f)}${skippedInvalidPhone ? ` · مستبعد لرقم غير صالح: ${skippedInvalidPhone}` : ""}`,
    }).catch(() => {});
    return { ok: true, count: rows.length, skippedInvalidPhone, csv, filename };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
