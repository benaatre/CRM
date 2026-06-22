import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// نبضة لتحديث «آخر ظهور» للمستخدم الحالي.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  await prisma.user.update({ where: { id: session.user.id }, data: { lastSeenAt: new Date() } });
  return NextResponse.json({ ok: true });
}
