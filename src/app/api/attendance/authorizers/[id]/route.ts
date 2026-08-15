import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** تعديل جهة إذن (الاسم/التفعيل/الترتيب) — المالك فقط. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;
  const { id } = await params;

  let raw: { label?: unknown; isActive?: unknown; sortOrder?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const data: { label?: string; isActive?: boolean; sortOrder?: number } = {};
  if (typeof raw.label === "string" && raw.label.trim()) data.label = raw.label.trim().slice(0, 80);
  if (typeof raw.isActive === "boolean") data.isActive = raw.isActive;
  if (Number.isFinite(Number(raw.sortOrder))) data.sortOrder = Math.round(Number(raw.sortOrder));
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "ما فيه شي للتعديل" }, { status: 400 });
  }

  try {
    const authorizer = await prisma.attendanceAuthorizer.update({ where: { id }, data });
    return NextResponse.json({ ok: true, authorizer });
  } catch {
    return NextResponse.json({ ok: false, error: "الجهة غير موجودة" }, { status: 404 });
  }
}

/**
 * «حذف» جهة = تعطيل (isActive=false) لا مسحًا — سجلات التوقف تحمل نسخة نصية
 * من الاسم، والتعطيل يحفظ الإحالة التاريخية سليمة.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;
  const { id } = await params;

  try {
    await prisma.attendanceAuthorizer.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "الجهة غير موجودة" }, { status: 404 });
  }
}
