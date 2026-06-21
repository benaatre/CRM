"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { unitTypeLabel, unitStatusLabels, unitStatusColor } from "@/lib/labels";
import { formatCurrency, toArabicDigits } from "@/lib/format";
import type { UnitRow } from "@/lib/data/projects";

export function UnitsTable({ rows }: { rows: UnitRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => rows.filter((u) => !q || u.number.includes(q) || unitTypeLabel(u.type).includes(q)),
    [rows, q],
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث برقم الوحدة أو النوع…" className="w-full rounded-xl border border-border bg-card py-2.5 pr-9 pl-3 text-sm outline-none focus:border-gold" />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-right text-sm">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">الوحدة</th>
              <th className="px-4 py-3 font-medium">النوع</th>
              <th className="px-4 py-3 font-medium">الدور</th>
              <th className="px-4 py-3 font-medium">المساحة</th>
              <th className="px-4 py-3 font-medium">السعر</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
              <th className="px-4 py-3 font-medium">المشتري</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">ما فيه وحدات مطابقة.</td></tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-foreground" dir="ltr">{u.number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{unitTypeLabel(u.type)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.floor ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.area ? `${toArabicDigits(u.area)} م²` : "—"}</td>
                  <td className="px-4 py-3 text-gold">{formatCurrency(u.price)}</td>
                  <td className={`px-4 py-3 ${unitStatusColor[u.status]}`}>{unitStatusLabels[u.status]}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.buyerName ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
