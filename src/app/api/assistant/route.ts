import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildAiContext } from "@/lib/data/ai-context";

export const runtime = "nodejs";

const SYSTEM = `أنت مساعد ذكي داخل نظام CRM عقاري لشركة «مشاريع السلطان» بالسعودية.
- جاوب بالعربي بلهجة سعودية طبيعية، باختصار ووضوح ومباشر.
- اعتمد فقط على البيانات المعطاة (JSON). لا تخترع أرقامًا ولا أسعارًا ولا عملاء.
- إذا البيانات ما تكفي للإجابة، قل بصراحة إنها ما تكفي واقترح وش يحتاج.
- العملة ريال سعودي (ر.س). اختصر الأرقام الكبيرة عند الحاجة.`;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  }

  let question = "";
  try {
    const body = await req.json();
    question = String(body?.question ?? "").trim();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  if (!question) return NextResponse.json({ error: "اكتب سؤالك" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      answer:
        "المساعد الذكي غير مفعّل حاليًا. أضِف ANTHROPIC_API_KEY في ملف البيئة (.env) عشان يشتغل.",
    });
  }

  try {
    const context = await buildAiContext({
      id: session.user.id,
      role: session.user.role,
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        max_tokens: 800,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `بيانات النظام الحالية (JSON):\n${context}\n\nسؤال المستخدم: ${question}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "تعذّر الاتصال بالمساعد، تأكد من المفتاح وحاول مرة ثانية." },
        { status: 502 },
      );
    }

    const data = await res.json();
    const answer =
      data?.content?.[0]?.text ?? "ما قدرت أطلّع إجابة، جرّب تعيد صياغة السؤال.";
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json({ error: "صار خطأ غير متوقّع" }, { status: 500 });
  }
}
