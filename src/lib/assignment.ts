// دوال عرض فقط لحساب «منذ متى ينتظر العميل» — تعتمد لحظة استلام الموظف (assignedAt) لا تاريخ إنشاء
// العميل في النظام (createdAt). ⚠️ للعرض فقط: لا تُعيد توجيه أي مسار كتابة (create/update) عبر هذا الملف.

type WaitingInput = {
  assignedAt: Date | null;
  createdAt: Date | null; // قد يُحجب (null) عن الموظف؛ نرجع لِلإسناد حينها
  lastContact: Date | null;
};

/**
 * المرجع الزمني للانتظار = الأحدث بين آخر تواصل و«لحظة الاستلام» (assignedAt، أو createdAt احتياطًا).
 * فالعدّاد يبدأ من استلام الموظف للعميل ويتصفّر عند أي تواصل لاحق — لا من دخول العميل النظام.
 */
export function waitingSince(lead: WaitingInput): Date {
  const base = lead.assignedAt ?? lead.createdAt ?? new Date(0);
  return lead.lastContact && lead.lastContact > base ? lead.lastContact : base;
}

/** عدد الأيام الكاملة منذ waitingSince حتى الآن (٠ فأكثر). */
export function daysWaiting(lead: WaitingInput, now: Date = new Date()): number {
  const ms = now.getTime() - waitingSince(lead).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
