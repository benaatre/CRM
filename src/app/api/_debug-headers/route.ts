import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // بلا هذا قد يُخبَّأ الرد فتضيع فائدته

/**
 * ⚠️ مسار تشخيصي مؤقت — يُحذف فور معرفة الجواب.
 *
 * الغرض: معرفة أي ترويسات بروكسي تصل فعلًا في إنتاج Hostinger، للحكم على
 * سلامة طبقة الحدّ على مستوى IP في src/auth.ts:
 *   ١. هل تصل x-forwarded-for أو x-real-ip أصلًا؟ (غيابهما ⇒ كل المستخدمين
 *      في دلو "unknown" واحد ⇒ قفل جماعي)
 *   ٢. هل يستبدل البروكسي القيمة أم يُلحق بها قيمة العميل؟ (الإلحاق ⇒ أول
 *      قيمة يتحكّم فيها المهاجم ⇒ تجاوز الحدّ بتزوير الترويسة)
 *
 * محروس بمفتاح ثابت في الكود: المسار مؤقت ولا يكشف إلا ترويسات الطلب نفسه.
 * أي طلب بلا المفتاح الصحيح يرى 404 لا 401 — فلا يكشف وجود المسار أصلًا.
 */

const KEY = "213b26385610702368283267f25feaac97a7d8b638ba12a7";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== KEY) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const h = await headers();

  const xff = h.get("x-forwarded-for");
  // نفس اشتقاق src/auth.ts حرفيًا — لنرى ما الذي سيستعمله فعلًا كمفتاح حدّ.
  const firstHop = xff?.split(",")[0]?.trim() ?? null;

  // كل ترويسة تبدأ بـx-forwarded أو x-real
  const forwardedFamily: Record<string, string> = {};
  h.forEach((value, name) => {
    const n = name.toLowerCase();
    if (n.startsWith("x-forwarded") || n.startsWith("x-real")) forwardedFamily[n] = value;
  });

  // ترويسات مصدر شائعة أخرى — لو غابت العائلة أعلاه قد يكون البديل هنا.
  const otherIpHeaders: Record<string, string> = {};
  for (const n of ["forwarded", "cf-connecting-ip", "true-client-ip", "x-client-ip", "remote-addr"]) {
    const v = h.get(n);
    if (v) otherIpHeaders[n] = v;
  }

  return NextResponse.json(
    {
      // ===== المطلوب صراحةً =====
      "x-forwarded-for": xff,
      "x-real-ip": h.get("x-real-ip"),
      "x-forwarded-host": h.get("x-forwarded-host"),
      forwardedFamily,

      // ===== ما يحسم القرار =====
      /** ما الذي ستستعمله clientIp() في src/auth.ts كمفتاح للحدّ */
      resolvedIp: firstHop ?? h.get("x-real-ip")?.trim() ?? "unknown",
      /** عدد القفزات في x-forwarded-for — أكثر من واحدة يعني إلحاقًا لا استبدالًا */
      xffHopCount: xff ? xff.split(",").length : 0,
      otherIpHeaders,

      // ===== سياق =====
      allHeaderNames: [...h.keys()].sort(),
      note: "مسار مؤقت — احذفه بعد القراءة",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
