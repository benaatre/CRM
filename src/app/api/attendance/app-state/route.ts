import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { trackActivityWindow, closeActivityWindow } from "@/lib/activity-window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * إشارة دورة حياة التطبيق (appStateChange) — تحسين دقة قياس «عن بُعد» لا
 * أساسه: `active` يعامَل كنبضة، و`inactive` يقفل الفترة الجارية لحظيًا.
 * heartbeat يبقى مصدر الحقيقة لو غابت هذي الإشارة كليًا.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  let raw: { active?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const now = new Date();
  if (raw.active === false) await closeActivityWindow(session.user.id, now).catch(() => {});
  else await trackActivityWindow(session.user.id, now).catch(() => {});

  return NextResponse.json({ ok: true });
}
