import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** حذف استثناء — المالك فقط. الحذف فعلي: الاستثناء منحة قابلة للسحب لا سجل بصم. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const exists = await prisma.attendanceException.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ ok: false, error: "الاستثناء غير موجود" }, { status: 404 });

  await prisma.attendanceException.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
