import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerApi } from "@/lib/attendance-guard";
import { parseLocation } from "@/lib/attendance-location-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** تعديل موقع — كل الحقول اختيارية، ويقبل `isActive` للتشغيل/التعطيل. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { id } = await params;
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });
  }

  const parsed = parseLocation(raw, true);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const data: Record<string, unknown> = { ...parsed.data };
  if (typeof raw.isActive === "boolean") data.isActive = raw.isActive;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "ما فيه شي للتعديل" }, { status: 400 });
  }

  const exists = await prisma.attendanceLocation.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ ok: false, error: "الموقع غير موجود" }, { status: 404 });

  const location = await prisma.attendanceLocation.update({ where: { id }, data });
  return NextResponse.json({ ok: true, location });
}

/**
 * «حذف» الموقع = تعطيله (isActive=false) لا محوه.
 *
 * السبب: البصمات القديمة مربوطة به، ومحوه يفقد سجلّها معناه (الاسم يصير null).
 * التعطيل يوقف مطابقته للبصمات الجديدة ويُبقي التاريخ سليمًا.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOwnerApi();
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const exists = await prisma.attendanceLocation.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ ok: false, error: "الموقع غير موجود" }, { status: 404 });

  const location = await prisma.attendanceLocation.update({
    where: { id },
    data: { isActive: false },
  });
  return NextResponse.json({ ok: true, location });
}
