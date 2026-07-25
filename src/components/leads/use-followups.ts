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

/**
 * حدث من فعل النظام (لا متابعة): تنزيل «مهتم راكد» وما شابهه — مصدره Activity
 * بلا مستخدم (userId = null). يُعرض في السجل موسومًا «تلقائي — النظام»، ولا يُنسب لموظف أبدًا.
 */
export type SystemEvent = {
  id: string;
  note: string;
  type: string;
  createdAt: string;
};

/** جلب متابعات عميل (تصاعديًا) + أحداث النظام، مع دالة إعادة تحميل. */
export function useFollowUps(leadId: string) {
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/followups`);
      const data = await res.json();
      if (res.ok) {
        setItems(data.items ?? []);
        setSystemEvents(data.systemEvents ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { reload(); }, [reload]);

  return { items, systemEvents, loading, reload };
}
