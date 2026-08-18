import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { createLeaveRequest, listMyLeaves, listLeaves } from "@/lib/data/leaves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * طلبات الإجازة.
 * POST — الموظف يقدّم طلبًا (يُنشأ PENDING، لا سريان إلا باعتماد المالك).
 * GET  — المالك يرى الكل (اختياريًا ?status=)، والموظف يرى طلباته فقط (بلا رصيد).
 * الحارس auth() لا requireUser: مسار API يرجّع 401 صريحًا لا تحويل 3xx.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  // المالك مراقب لا مرصود — لا يقدّم طلبات إجازة.
  if (session.user.role === Role.OWNER) {
    return NextResponse.json({ ok: false, message: "المالك خارج نظام الإجازات" }, { status: 403 });
  }

  let body: { type?: unknown; fromKey?: unknown; toKey?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "بيانات غير صالحة" }, { status: 400 });
  }

  const r = await createLeaveRequest(session.user.id, body);
  return NextResponse.json(r, r.ok ? undefined : { status: r.status ?? 400 });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  if (session.user.role === Role.OWNER) {
    const status = new URL(req.url).searchParams.get("status");
    return NextResponse.json({ ok: true, requests: await listLeaves({ status }) });
  }
  return NextResponse.json({ ok: true, requests: await listMyLeaves(session.user.id) });
}
