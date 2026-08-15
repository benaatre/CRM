import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * جهات الإذن بالخروج — القراءة لأي مستخدم مسجّل (شاشة «مين أذن لك؟» عند
 * الموظف تحتاج القائمة النشطة)، والإدارة للمالك وحده. `?all=1` للمالك يعيد
 * المعطّلة أيضًا (شاشة الإعدادات).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  const wantAll = new URL(req.url).searchParams.get("all") === "1" && session.user.role === "OWNER";
  const authorizers = await prisma.attendanceAuthorizer.findMany({
    where: wantAll ? {} : { isActive: true },
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  return NextResponse.json({ ok: true, authorizers });
}

/** إضافة جهة — المالك فقط. */
export async function POST(req: Request) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  let raw: { label?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }
  const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 80) : "";
  if (!label) {
    return NextResponse.json({ ok: false, error: "اكتب اسم الجهة" }, { status: 400 });
  }

  const max = await prisma.attendanceAuthorizer.aggregate({ _max: { sortOrder: true } });
  const authorizer = await prisma.attendanceAuthorizer.create({
    data: { label, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json({ ok: true, authorizer });
}
