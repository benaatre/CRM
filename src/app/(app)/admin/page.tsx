import { Role } from "@prisma/client";
import { requireManager } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/lib/labels";

// منطقة المدير — صلاحية مزدوجة: middleware + requireManager على الخادم.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // يحوّل غير المدير للوحة (حماية خادمية حتى لو تجاوز الـ middleware).
  await requireManager();

  let team: { id: string; name: string; role: Role; targetDeals: number; active: boolean }[] = [];
  try {
    team = await prisma.user.findMany({
      select: { id: true, name: true, role: true, targetDeals: true, active: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
  } catch {
    // قاعدة البيانات غير مهيّأة بعد.
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">الموظفين</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          هذي الشاشة للمدير فقط — الموظف لو حاول يفتحها ينحوّل تلقائيًا.
        </p>
      </header>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-right text-sm">
          <thead className="bg-secondary/50 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">الاسم</th>
              <th className="px-4 py-3 font-medium">الدور</th>
              <th className="px-4 py-3 font-medium">الهدف</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {team.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  ما فيه بيانات — شغّل <code dir="ltr">npm run db:seed</code>
                </td>
              </tr>
            ) : (
              team.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-foreground">{u.name}</td>
                  <td className="px-4 py-3 text-gold">{roleLabel(u.role)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {u.targetDeals > 0 ? `${u.targetDeals} صفقة` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {u.active ? (
                      <span className="text-success">مفعّل</span>
                    ) : (
                      <span className="text-muted-foreground">موقوف</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
