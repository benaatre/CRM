"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { toUserError } from "@/lib/action-error";
import { requireManager } from "@/lib/auth-guards";
import { runReassignSweep } from "@/lib/auto-distribute";

export type ActionResult = { ok: boolean; error?: string; message?: string };

export type DistConfig = {
  autoDistribute: boolean;
  distStartHour: number;
  distEndHour: number;
  distTimeoutMin: number;
  distPresenceMin: number;
  distInitialMode: "ROUND_ROBIN" | "LEAST_LOADED";
  distReassignMode: "MOST_ACTIVE" | "ROTATION";
  order: string[];
};

export type DistEmployee = {
  id: string; name: string; active: boolean; online: boolean;
  paused: boolean; pauseReason: string | null; pauseUntil: Date | null;
};

const ONLINE_MS = 5 * 60 * 1000;

/** إعدادات التوزيع + قائمة الموظفين (للوحة الإعدادات). */
export async function getDistributionConfig(): Promise<{ config: DistConfig; employees: DistEmployee[] }> {
  await requireManager();
  const s = await prisma.settings.upsert({
    where: { id: "singleton" }, update: {}, create: { id: "singleton" },
    select: {
      autoDistribute: true, distStartHour: true, distEndHour: true, distTimeoutMin: true,
      distPresenceMin: true, distOrder: true, distInitialMode: true, distReassignMode: true,
    },
  });
  const emps = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    select: { id: true, name: true, active: true, lastSeenAt: true, availabilityPaused: true, pauseReason: true, pauseUntil: true },
    orderBy: { name: "asc" },
  });
  const now = Date.now();
  // رتّب القائمة: المشاركون (بترتيب distOrder) أولًا، ثم البقية.
  const inOrder = s.distOrder.filter((id) => emps.some((e) => e.id === id));
  const rest = emps.map((e) => e.id).filter((id) => !inOrder.includes(id));
  const ordered = [...inOrder, ...rest];
  const byId = new Map(emps.map((e) => [e.id, e]));
  return {
    config: {
      autoDistribute: s.autoDistribute,
      distStartHour: s.distStartHour,
      distEndHour: s.distEndHour,
      distTimeoutMin: s.distTimeoutMin,
      distPresenceMin: s.distPresenceMin,
      distInitialMode: s.distInitialMode as DistConfig["distInitialMode"],
      distReassignMode: s.distReassignMode as DistConfig["distReassignMode"],
      order: inOrder,
    },
    employees: ordered.map((id) => {
      const e = byId.get(id)!;
      return {
        id: e.id, name: e.name, active: e.active,
        online: !!e.lastSeenAt && now - e.lastSeenAt.getTime() < ONLINE_MS,
        paused: e.availabilityPaused, pauseReason: e.pauseReason, pauseUntil: e.pauseUntil,
      };
    }),
  };
}

function clampHour(n: number) { return Math.min(23, Math.max(0, Math.round(n))); }

/** حفظ إعدادات التوزيع — للمالك/المدير فقط (تحقّق على الخادم). */
export async function updateDistributionConfig(input: DistConfig): Promise<ActionResult> {
  try {
    await requireManager();
    const order = [...new Set((input.order ?? []).filter(Boolean))];
    // تحقّق أن المعرّفات تخص موظفين فعليين.
    if (order.length > 0) {
      const valid = await prisma.user.findMany({ where: { id: { in: order }, role: "EMPLOYEE" }, select: { id: true } });
      const validSet = new Set(valid.map((v) => v.id));
      if (order.some((id) => !validSet.has(id))) return { ok: false, error: "في موظف غير صالح بالقائمة" };
    }
    if (input.autoDistribute && order.length === 0) {
      return { ok: false, error: "اختر موظفًا واحدًا على الأقل للمشاركة في التوزيع" };
    }
    const startHour = clampHour(input.distStartHour);
    const endHour = clampHour(input.distEndHour);
    const timeout = Math.max(1, Math.round(input.distTimeoutMin || 60));
    const presence = Math.max(0, Math.round(input.distPresenceMin ?? 30));
    const initialMode = input.distInitialMode === "LEAST_LOADED" ? "LEAST_LOADED" : "ROUND_ROBIN";
    const reassignMode = input.distReassignMode === "ROTATION" ? "ROTATION" : "MOST_ACTIVE";

    await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        autoDistribute: !!input.autoDistribute,
        distStartHour: startHour,
        distEndHour: endHour,
        distTimeoutMin: timeout,
        distPresenceMin: presence,
        distInitialMode: initialMode,
        distReassignMode: reassignMode,
        distOrder: order,
        // المؤشّر يشير لآخر من استلم — نضبطه على آخر القائمة حتى يبدأ الدور من الأول (#41).
        distPointer: order.length > 0 ? order.length - 1 : 0,
      },
    });
    revalidatePath("/distribution");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

/** تشغيل فحص إعادة التوجيه يدويًا (زر «افحص الآن» في اللوحة). */
export async function runSweepNow(): Promise<ActionResult> {
  try {
    await requireManager();
    const res = await runReassignSweep();
    if (!res.ok) return { ok: false, error: res.error ?? "صار خطأ" };
    revalidatePath("/distribution");
    revalidatePath("/leads");
    return { ok: true, message: res.skipped ?? `تم الفحص — أُعيد توجيه ${res.reassigned} من ${res.checked} متأخّر` };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}
