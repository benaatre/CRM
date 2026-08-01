import { cn } from "@/lib/utils";

/**
 * نص جدول طويل: سطر واحد يُقصّ بثلاث نقاط ضمن سقف عرض، والتلميح (hover) يعرضه كاملًا.
 *
 * ليه سقف العرض على العنصر الداخلي لا على <td>: في تخطيط الجدول التلقائي، max-width
 * على الخلية نفسها لا يُحسب ضمن العرض المفضّل بشكل موثوق عبر المتصفحات — أما عنصر
 * block داخلها فسقفه ملزم، و`overflow:hidden` يجعل أضيق مساهمة للعمود شبه صفر،
 * فينكمش العمود عند الضيق بدل أن يدفع الأعمدة الطرفية خارج الحاوية.
 *
 * الاستعمال: <Clip className="max-w-[12rem]" title={x}>{x}</Clip>
 * (صنف السقف يُمرَّر ثابتًا حتى يلتقطه Tailwind عند البناء.)
 */
export function Clip({
  className, title, dir, children,
}: {
  /** سقف العرض — صنف Tailwind ثابت مثل max-w-[12rem]. */
  className?: string;
  /** النص الكامل للتلميح — مرّره دائمًا مع النصوص القابلة للقصّ. */
  title?: string;
  dir?: "rtl" | "ltr";
  children: React.ReactNode;
}) {
  return (
    <span dir={dir} title={title} className={cn("block truncate", className)}>
      {children}
    </span>
  );
}
