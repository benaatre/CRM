import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth-guards";
import { getProject } from "@/lib/data/projects";
import {
  projectStatusLabels,
  projectStatusColor,
  unitTypeLabel,
  unitStatusLabels,
  unitStatusColor,
} from "@/lib/labels";
import { formatCurrency, formatDate, toArabicDigits } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const p = await getProject(id);
  if (!p) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4" />
        المشاريع
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{p.name}</h1>
          {p.district && <p className="mt-1 text-sm text-muted-foreground">{p.district}</p>}
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm ${projectStatusColor[p.status]}`}>
          {projectStatusLabels[p.status]}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Mini label="الوحدات" value={p.units.total} />
        <Mini label="متاحة" value={p.units.available} className="text-success" />
        <Mini label="محجوزة" value={p.units.reserved} className="text-warning" />
        <Mini label="مباعة" value={p.units.sold} className="text-muted-foreground" />
      </div>

      <div className="flex flex-wrap gap-6 rounded-2xl border border-border bg-card p-4 text-sm">
        <div>
          <span className="text-muted-foreground">نطاق السعر: </span>
          <span className="text-gold">
            {p.priceMin ? formatCurrency(p.priceMin) : "—"}
            {p.priceMax ? ` – ${formatCurrency(p.priceMax)}` : ""}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">التسليم: </span>
          <span className="text-foreground">{p.deliveryDate ? formatDate(p.deliveryDate) : "—"}</span>
        </div>
        {p.falLicense && (
          <div>
            <span className="text-muted-foreground">ترخيص فال: </span>
            <span className="text-foreground">{p.falLicense}</span>
          </div>
        )}
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
            {p.unitRows.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium text-foreground" dir="ltr">{u.number}</td>
                <td className="px-4 py-3 text-muted-foreground">{unitTypeLabel(u.type)}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.floor ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.area ? `${toArabicDigits(u.area)} م²` : "—"}</td>
                <td className="px-4 py-3 text-gold">{formatCurrency(u.price)}</td>
                <td className={`px-4 py-3 ${unitStatusColor[u.status]}`}>{unitStatusLabels[u.status]}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.buyerName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Mini({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="glass rounded-2xl p-4 text-center">
      <div className={`text-2xl font-bold ${className ?? "text-foreground"}`}>{toArabicDigits(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
