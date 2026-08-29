import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «الصندوق الأسود» — مسجل تشخيص حي لمسار الموقع (29/08، مؤقت حتى Build 5):
 * الفحص بالكيبل غير متاح، فالأجهزة ترسل خطواتها هنا ونقرأها من السيرفر.
 *
 * - POST: من مستخدم مسجّل فقط + حد معدل بسيط — يُخزن في **ذاكرة العملية**
 *   (مصفوفة دوارة، آخر ٥٠٠ سجل) — صفر schema وصفر قاعدة بيانات، ويُمسح
 *   بإعادة تشغيل التطبيق (مقبول لأداة تشخيص).
 * - GET ?token=<CRON_SECRET>: يعرض السجلات JSON مجمّعة لكل جهاز مرتبة بالوقت.
 *   السر الموحّد القائم في .env/hPanel عمدًا — لا متغير بيئة جديدًا ينتظر ضبطًا.
 */

type Rec = {
  /** وقت السيرفر (المرجع) */
  at: string;
  userId: string;
  user: string;
  step: string;
  detail: string;
  /** وقت العميل كما أرسله */
  ts: string;
  ua: string;
};

const MAX_RECORDS = 500;
const ring: Rec[] = [];

/** حد المعدل: ٢٤٠ سجلًا/دقيقة لكل مستخدم — يمنع الإغراق ولا يخنق التشخيص. */
const RATE_LIMIT_PER_MIN = 240;
const rate = new Map<string, { windowStart: number; count: number }>();

function allow(userId: string): boolean {
  const now = Date.now();
  const r = rate.get(userId);
  if (!r || now - r.windowStart > 60_000) {
    rate.set(userId, { windowStart: now, count: 1 });
    return true;
  }
  r.count++;
  return r.count <= RATE_LIMIT_PER_MIN;
}

const s = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  if (!allow(session.user.id)) return NextResponse.json({ ok: false }, { status: 429 });

  let raw: { step?: unknown; detail?: unknown; ts?: unknown; ua?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const step = s(raw.step, 80);
  if (!step) return NextResponse.json({ ok: false }, { status: 400 });

  ring.push({
    at: new Date().toISOString(),
    userId: session.user.id,
    user: session.user.name ?? "?",
    step,
    detail: s(raw.detail, 300),
    ts: s(raw.ts, 40),
    ua: s(raw.ua, 120),
  });
  if (ring.length > MAX_RECORDS) ring.splice(0, ring.length - MAX_RECORDS);

  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || token !== secret) {
    return NextResponse.json({ ok: false, error: "غير مصرّح" }, { status: 401 });
  }

  // تجميع لكل جهاز (المستخدم + بصمة الجهاز المختصرة) — مرتب بوقت السيرفر.
  const devices: Record<string, Rec[]> = {};
  for (const r of [...ring].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = `${r.user} · ${r.ua.slice(0, 60) || "جهاز؟"}`;
    (devices[key] ??= []).push(r);
  }
  return NextResponse.json({ ok: true, total: ring.length, devices });
}
