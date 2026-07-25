"use client";

import { useCallback, useEffect, useState } from "react";
import type { FollowUpType, FollowUpResult, FollowUpSection, LeadStage } from "@prisma/client";

export type FollowUpItem = {
  id: string;
  type: FollowUpType;
  result: FollowUpResult;
  section: FollowUpSection | null;
  stageAfter: LeadStage | null;
  note: string | null;
  nextDate: string | null;
  createdAt: string;
  employeeName: string | null;
  /**
   * كاتبها هو المسند له العميل الآن؟ false = سجّلها موظف/مدير سابق قبل نقل العميل —
   * تُوسم في السجل بوضوح («ليست من تسجيلك») حتى لا يظنها الموظف الحالي متابعةً شبحية.
   */
  byCurrentOwner: boolean;
  /** كاتبها هو المستخدم الحالي (للتمييز البصري في السجل). */
  mine: boolean;
  /** عُدّلت بعد تسجيلها (وسم «مُعدَّلة» — من سجل التدقيق). */
  edited: boolean;
  /** يحق للمستخدم الحالي تعديلها (الخادم يعيد الفرض عند الحفظ). */
  canEdit: boolean;
  /** يحق تعديل النتيجة (مالك/مدير فقط). */
  canEditResult: boolean;
};

/** جلب متابعات عميل (تصاعديًا) مع دالة إعادة تحميل. */
export function useFollowUps(leadId: string) {
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/followups`);
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { reload(); }, [reload]);

  return { items, loading, reload };
}
