import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * تسجيل/إزالة توكن جهاز لإشعارات Push.
 *
 * الحارس: auth() مباشرة لا requireUser() — requireUser يستخدم redirect() وهذا
 * سلوك صفحات لا route handler (يرجّع 3xx لطلب fetch بدل 401 واضح). نفس نمط
 * /api/heartbeat في هذا الريبو.
 */

const PLATFORMS = new Set(["android", "ios", "web"]);

type Body = { token?: unknown; platform?: unknown };

/** يقرأ ويتحقق من جسم الطلب — يرجّع null لو غير صالح. */
async function parseBody(req: Request): Promise<{ token: string; platform: string } | null> {
  let raw: Body;
  try {
    raw = (await req.json()) as Body;
  } catch {
    return null;
  }
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  const platform = typeof raw.platform === "string" ? raw.platform.trim().toLowerCase() : "android";
  // توكنات FCM طويلة (~١٥٠ محرفًا فأكثر) — نحدّ الطرفين ضد الحشو والقيم الفارغة.
  if (token.length < 20 || token.length > 4096) return null;
  if (!PLATFORMS.has(platform)) return null;
  return { token, platform };
}

/**
 * upsert على token (لا على userId): الجهاز الواحد قد ينتقل بين موظفين على نفس
 * الجهاز — فالـupsert يعيد ربط التوكن بصاحبه الحالي بدل ترك صف يتيم يرسل
 * إشعارات الموظف السابق لجهاز الموظف الجديد.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await parseBody(req);
  if (!body) return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });

  await prisma.deviceToken.upsert({
    where: { token: body.token },
    create: { token: body.token, platform: body.platform, userId: session.user.id },
    update: { userId: session.user.id, platform: body.platform },
  });

  return NextResponse.json({ ok: true });
}

/**
 * إزالة التوكن — عند الخروج. نحذف بالتوكن مقيّدًا بالمستخدم الحالي حتى لا يقدر
 * أحد على حذف تسجيل جهاز غيره بتخمين توكن.
 */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await parseBody(req);
  if (!body) return NextResponse.json({ ok: false, error: "بيانات غير صالحة" }, { status: 400 });

  await prisma.deviceToken.deleteMany({ where: { token: body.token, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
