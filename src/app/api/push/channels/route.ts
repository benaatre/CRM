import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureChannelDefaults, getChannelConfig } from "@/lib/data/push-channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * إعداد قنوات الإشعارات الحالي — يقرأه التطبيق عند كل إقلاع لينشئ القنوات
 * المطابقة لنغمات المالك، ويحذف القنوات القديمة التي بطل استعمالها.
 *
 * الحارس auth() لا requireUser(): هذا route handler وrequireUser يستخدم
 * redirect() (سلوك صفحات) فيرجّع 3xx لطلب fetch بدل 401 واضح.
 * لا يكشف شيئًا حسّاسًا — أسماء قنوات ونغمات فقط — لكن يبقى خلف المصادقة.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  await ensureChannelDefaults();
  const channels = await getChannelConfig();

  return NextResponse.json({
    ok: true,
    channels: channels.map((c) => ({
      id: c.channelId,
      category: c.category,
      name: c.label,
      description: c.description,
      sound: c.sound,
      importance: c.importance,
      vibration: c.vibration,
    })),
  });
}
