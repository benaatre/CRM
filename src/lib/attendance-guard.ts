import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";

/**
 * حارس مسارات حوكمة الدوام الإدارية — المالك فقط، **على الخادم**.
 *
 * إخفاء الصفحة من القائمة ليس صلاحية: أي أحد يقدر ينادي المسار مباشرة، فالفحص
 * هنا هو الباب الحقيقي. auth() لا requireRole(): مسارات API ترجّع 401/403 صريحة
 * بدل تحويل 3xx لا يفهمه fetch.
 */
export async function requireOwnerApi(): Promise<
  { ok: true; userId: string } | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ ok: false }, { status: 401 }) };
  }
  if (session.user.role !== Role.OWNER) {
    return {
      ok: false,
      res: NextResponse.json(
        { ok: false, error: "هذي الشاشة للمالك فقط" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, userId: session.user.id };
}
