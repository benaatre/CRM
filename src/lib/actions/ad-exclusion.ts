"use server";

import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth-guards";
import { dedupeKey } from "@/lib/phone-dupe";
import { followUpResultLabels } from "@/lib/labels";
import { logAudit } from "@/lib/audit";

/**
 * تصدير «غير المهتمين» لاستبعاد الإعلانات (Meta Custom Audience) — للمالك حصرًا.
 *
 * قراءة تجميعية خالصة: صفر كتابة على Lead، صفر schema. النطاق: CLOSED_LOST بكل
 * أسبابه، مع استثناء إلزامي لمن موعده المستقبلي حي (nextDate > الآن في أحدث
 * متابعاته) — وFOLLOW_UP_LATER لا تدخل أصلًا (مرحلة ضمن مظلة المهتم لا خاسر).
 * الجوال يطبَّع دوليًا +966XXXXXXXXX عبر dedupeKey القائم (آخر ٩ أرقام)؛
 * الرقم غير الصالح (<٩ خانات) يُستبعد ويُحصى. لا عمود email — ‏Lead بلا حقل
 * email في المخطط أصلًا. «تاريخ الإغلاق» = updatedAt (العرف القائم كوكيل).
 */

export type AdExclusionOpts = {
  /** تضمين المؤرشفين (الافتراضي نعم). */
  includeArchived: boolean;
  /** نافذة الإغلاق بالأشهر: 0 = الكل، أو 3 / 6 / 12. */
  months: 0 | 3 | 6 | 12;
};

export type AdExclusionResult =
  | { ok: true; count: number; skippedInvalidPhone: number; csv?: string; filename?: string }
  | { ok: false; error: string };

const DAY_MS = 86_400_000;
const MONTH_DAYS: Record<3 | 6 | 12, number> = { 3: 90, 6: 180, 12: 365 };

/** يهرب حقل CSV: تغليف بعلامتي اقتباس عند الحاجة ومضاعفة الداخلية. */
function csvField(v: string): string {
  // تحييد حقن المعادلات: خلية تبدأ بـ = + - @ أو tab/CR تنفَّذ كصيغة عند فتح
  // الملف بإكسل — نسبقها بفاصلة عليا فتُعرض نصًّا خاملًا (أسماء العملاء تصل
  // من نماذج إعلانات خارجية، فالمدخل غير موثوق).
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * countOnly=true: العدّاد الحي للواجهة (بلا CSV وبلا تدقيق).
 * countOnly=false: يبني الملف ويسجل سطر التدقيق الواحد (من، متى، كم صف).
 */
export async function buildAdExclusion(opts: AdExclusionOpts, countOnly: boolean): Promise<AdExclusionResult> {
  try {
    const user = await requireUser();
    if (user.role !== "OWNER") return { ok: false, error: "تصدير الاستبعاد الإعلاني للمالك فقط" };

    const cutoff = opts.months !== 0 ? new Date(Date.now() - MONTH_DAYS[opts.months] * DAY_MS) : null;
    const leads = await prisma.lead.findMany({
      where: {
        stage: "CLOSED_LOST",
        ...(opts.includeArchived ? {} : { isArchived: false }),
        ...(cutoff ? { updatedAt: { gte: cutoff } } : {}),
      },
      select: { id: true, name: true, phone: true, updatedAt: true, assignedTo: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    });

    // أحدث متابعة لكل عميل — للسبب ولاستثناء الموعد المستقبلي (استعلام واحد، أول ظهور = الأحدث).
    const ids = leads.map((l) => l.id);
    const fus = ids.length
      ? await prisma.followUp.findMany({
          where: { leadId: { in: ids } },
          orderBy: { createdAt: "desc" },
          select: { leadId: true, result: true, nextDate: true },
        })
      : [];
    const latest = new Map<string, { result: string; nextDate: Date | null }>();
    for (const f of fus) if (!latest.has(f.leadId)) latest.set(f.leadId, f);

    const now = Date.now();
    let skippedInvalidPhone = 0;
    const rows: string[] = [];
    for (const l of leads) {
      const last = latest.get(l.id);
      // الاستثناء الإلزامي: موعد متابعة مستقبلي حي = لا يدخل ملف الاستبعاد.
      if (last?.nextDate && last.nextDate.getTime() > now) continue;
      const key = dedupeKey(l.phone);
      if (!key) { skippedInvalidPhone++; continue; }
      if (countOnly) { rows.push(""); continue; }
      const reason = last?.result?.startsWith("NOT_INTERESTED")
        ? (followUpResultLabels as Record<string, string>)[last.result] ?? last.result
        : "غير محدد (سجل قديم)";
      rows.push([
        `+966${key}`,
        csvField(l.name),
        csvField(reason),
        l.updatedAt.toISOString().slice(0, 10),
        csvField(l.assignedTo?.name ?? "—"),
      ].join(","));
    }

    if (countOnly) return { ok: true, count: rows.length, skippedInvalidPhone };

    const csv = ["phone,name,not_interested_reason,closed_at,employee", ...rows].join("\r\n");
    const filename = `ad-exclusion-${new Date().toISOString().slice(0, 10)}.csv`;
    // سطر التدقيق الواحد الموثِّق — فشله لا يُفشِل التصدير.
    await logAudit(prisma, {
      userId: user.id,
      action: "leads.ad_exclusion_export",
      entity: "lead",
      entityId: "ad-exclusion",
      summary: `صدّر قائمة الاستبعاد الإعلاني: ${rows.length} صف (المدة: ${opts.months === 0 ? "الكل" : `آخر ${opts.months} أشهر`} · المؤرشفون: ${opts.includeArchived ? "نعم" : "لا"}${skippedInvalidPhone ? ` · مستبعد لرقم غير صالح: ${skippedInvalidPhone}` : ""})`,
    }).catch(() => {});
    return { ok: true, count: rows.length, skippedInvalidPhone, csv, filename };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
