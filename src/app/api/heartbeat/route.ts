import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordSessionBeat } from "@/lib/session-devices";

export const runtime = "nodejs";

// نبضة لتحديث «آخر ظهور» للمستخدم الحالي + تسجيل جهازه (لقسم «الجلسات» بالإعدادات).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  await prisma.user.update({ where: { id: session.user.id }, data: { lastSeenAt: new Date() } });
  // سجل الجهاز (جوال/كمبيوتر + المتصفح) — فشله لا يُفشِل النبضة.
  await recordSessionBeat(session.user.id, req.headers.get("user-agent")).catch(() => {});
  return NextResponse.json({ ok: true });
}
