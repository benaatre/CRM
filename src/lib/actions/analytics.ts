"use server";

import { requireManagerAction, requireUser, isManager } from "@/lib/auth-guards";
import {
  getProjectFinance, getAllProjectsFinance, getEmployeeDeepAnalysis,
  type ProjectFinance, type AllProjectsFinanceRow, type EmployeeDeepAnalysis,
} from "@/lib/data/analytics";

/** جلب التحليل المالي لمشروع — للمالك/المدير فقط (يُتحقق على الخادم). */
export async function fetchProjectFinance(projectId: string): Promise<ProjectFinance | null> {
  await requireManagerAction();
  if (!projectId) return null;
  return getProjectFinance(projectId);
}

/** جلب مقارنة كل المشاريع — للمالك/المدير فقط. */
export async function fetchAllProjectsFinance(): Promise<AllProjectsFinanceRow[]> {
  await requireManagerAction();
  return getAllProjectsFinance();
}

/** تحليل أداء موظف — المدير لأي موظف، والموظف لنفسه فقط (صلاحية على الخادم). */
export async function fetchEmployeeAnalysis(userId: string): Promise<EmployeeDeepAnalysis | null> {
  const me = await requireUser();
  const targetId = isManager(me.role) ? userId : me.id;
  if (!targetId) return null;
  return getEmployeeDeepAnalysis(targetId, Date.now());
}
