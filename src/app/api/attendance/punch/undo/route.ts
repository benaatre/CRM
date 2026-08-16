import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** نافذة التراجع عن الانصراف بالثواني — نفس الرقم المعلن في واجهة البطاقة. */
const UNDO_WINDOW_MS = 90_000;

/**
 * «تراجع» — يلغي انصرافًا حديثًا (خلال ٩٠ ثانية) ويعيد فتح الجلسة كما كانت:
 * حذف بصمة الانصراف وإرجاع الجلسة مفتوحة. الموظف لنفسه فقط، والشرط الزمني
 * على الخادم لا على العميل. نداءات التحقق المعلّقة التي أُلغيت مع الانصراف لا
 * تُعاد (قرار مقبول — الكرون العشوائي القادم يغطي).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.user.role === Role.OWNER) {
    return NextResponse.json(
      { ok: false, reason: "owner_excluded", message: "المالك خارج نظام البصم" },
      { status: 403 },
    );
  }
  const userId = session.user.id;
  const now = new Date();

  const last = await prisma.attendanceSession.findFirst({
    where: {
      userId,
      endedAt: { gte: new Date(now.getTime() - UNDO_WINDOW_MS) },
      autoClosed: false,
      checkOutEventId: { not: null },
    },
    orderBy: { endedAt: "desc" },
  });
  if (!last) {
    return NextResponse.json({ ok: false, reason: "expired", message: "فات وقت التراجع" });
  }

  // جلسة أخرى انفتحت بعده؟ التراجع يخربط اليوم — نرفض بوضوح.
  const openAfter = await prisma.attendanceSession.findFirst({
    where: { userId, endedAt: null },
    select: { id: true },
  });
  if (openAfter) {
    return NextResponse.json({ ok: false, reason: "conflict", message: "عندك جلسة مفتوحة أصلًا" });
  }

  const checkOutEventId = last.checkOutEventId!;
  await prisma.$transaction(async (tx) => {
    await tx.attendanceSession.update({
      where: { id: last.id },
      data: { endedAt: null, workedMinutes: null, checkOutEventId: null },
    });
    await tx.attendanceEvent.delete({ where: { id: checkOutEventId } });
  });

  return NextResponse.json({ ok: true, message: "رجّعناك — دوامك مستمر كأن شيئًا لم يكن" });
}
