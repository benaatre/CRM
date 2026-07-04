import { NextResponse } from "next/server";
import type { LeadStage } from "@prisma/client";
import { auth } from "@/auth";
import { getLeadDetail } from "@/lib/data/leads";
import { stageLabels, channelLabel } from "@/lib/labels";

export const runtime = "nodejs";

type Analysis = {
  temperature: "حار" | "دافئ" | "بارد";
  interest: number;
  nextStep: string;
  whatsapp: string;
};

// تقدير حسابي احتياطي (يشتغل بدون مفتاح Anthropic).
function heuristic(
  stage: LeadStage,
  attempts: number,
  name: string,
  project: string | null,
): Analysis {
  const hot: LeadStage[] = ["VIEWING", "NEGOTIATION", "RESERVED"];
  const warm: LeadStage[] = ["INTERESTED", "FOLLOW_UP_LATER"];
  const interestByStage: Record<LeadStage, number> = {
    NEW: 40, ATTEMPTED: 30, INTERESTED: 60, FOLLOW_UP_LATER: 55,
    VIEWING: 75, NEGOTIATION: 85, RESERVED: 90, CLOSED_WON: 100, CLOSED_LOST: 10,
  };
  const temperature = hot.includes(stage) ? "حار" : warm.includes(stage) ? "دافئ" : "بارد";
  let interest = interestByStage[stage] ?? 40;
  if (attempts >= 3 && temperature !== "حار") interest = Math.max(10, interest - 15);

  const nextStepByStage: Record<LeadStage, string> = {
    NEW: "اتصل عليه بأسرع وقت — أول رد سريع يرفع التحويل.",
    ATTEMPTED: "جرّب وقت مختلف أو رسالة واتساب قصيرة.",
    INTERESTED: "ابعث تفاصيل الوحدة واقترح موعد معاينة.",
    FOLLOW_UP_LATER: "ذكّره بالموعد المتفق عليه.",
    VIEWING: "أكّد موعد المعاينة وجهّز الخيارات المناسبة.",
    NEGOTIATION: "اقفل على السعر النهائي وجهّز أوراق الحجز.",
    RESERVED: "تابع إجراءات التمويل/الإفراغ.",
    CLOSED_WON: "اطلب إحالة وقيّم تجربته.",
    CLOSED_LOST: "أعد إحياءه بعرض مختلف بعد فترة.",
  } as Record<LeadStage, string>;

  const whatsapp = `هلا ${name}، معك فريق المبيعات. عساك طيّب. حابين نكمّل معك بخصوص ${project ?? "الوحدة اللي تناسبك"} — متى يناسبك نتواصل؟`;

  return { temperature, interest, nextStep: nextStepByStage[stage] ?? "تابع العميل.", whatsapp };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });

  let leadId = "";
  try {
    leadId = String((await req.json())?.leadId ?? "");
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }
  const lead = await getLeadDetail(leadId);
  if (!lead) return NextResponse.json({ error: "العميل غير موجود" }, { status: 404 });

  const fallback = heuristic(lead.stage, lead.attempts, lead.name, lead.projectName);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ...fallback, source: "تقدير تلقائي" });

  try {
    const ctx = {
      الاسم: lead.name,
      المرحلة: stageLabels[lead.stage],
      القناة: channelLabel(lead.channel),
      المشروع: lead.projectName,
      الميزانية: lead.budget,
      المحاولات: lead.attempts,
      عدد_المتابعات: lead.activities.length,
    };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(30_000), // #30: يمنع تعليق الطلب
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        max_tokens: 600,
        system:
          'أنت خبير مبيعات عقاري سعودي. حلّل العميل وأرجع JSON فقط بهذا الشكل بدون أي نص إضافي: {"temperature":"حار|دافئ|بارد","interest":رقم 0-100,"nextStep":"خطوة عملية قصيرة","whatsapp":"رسالة واتساب جاهزة بلهجة سعودية"}. لا تخترع بيانات غير معطاة.',
        messages: [{ role: "user", content: `بيانات العميل:\n${JSON.stringify(ctx, null, 2)}` }],
      }),
    });
    if (!res.ok) return NextResponse.json({ ...fallback, source: "تقدير تلقائي" });
    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return NextResponse.json({
        temperature: parsed.temperature ?? fallback.temperature,
        interest: typeof parsed.interest === "number" ? parsed.interest : fallback.interest,
        nextStep: parsed.nextStep ?? fallback.nextStep,
        whatsapp: parsed.whatsapp ?? fallback.whatsapp,
        source: "كلود",
      });
    }
    return NextResponse.json({ ...fallback, source: "تقدير تلقائي" });
  } catch {
    return NextResponse.json({ ...fallback, source: "تقدير تلقائي" });
  }
}
