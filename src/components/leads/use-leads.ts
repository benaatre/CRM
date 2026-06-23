"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeadRow } from "@/lib/data/leads";

/**
 * مصدر بيانات العملاء المشترك للواجهة — يقرأ من GET /api/leads.
 * يُستخدم في جدول العملاء والكانبان فيصيران وجهتين لنفس الـ API.
 * يجلب عند التحميل وعند تغيّر الفلاتر (query)، ويتيح reload يدويًا بعد أي تعديل.
 */
export function useLeads(query: string) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads?${query}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setLeads(data.leads ?? []);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { reload(); }, [reload]);

  return { leads, loading, reload, setLeads };
}
