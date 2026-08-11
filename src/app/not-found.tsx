import Link from "next/link";
import { BackButton } from "@/components/back-button";

/**
 * «غير موجود» الجذرية — تخدم أمرين:
 *   ١) أي رابط لا يطابق مسارًا في التطبيق كله (قاعدة App Router: الجذر وحده
 *      يلتقط المسارات غير المطابقة).
 *   ٢) `notFound()` الصادر من صفحات الويب ((app)/leads/[id] و(app)/projects/[id]).
 *
 * ⚠️ خارج تخطيط الجوال — فمتغيّرات `--m-*` غير معرّفة هنا: الألوان من توكنز
 * الويب في globals.css (‏--background = ‎#0a0a0b‏ نفسه) عبر أصناف Tailwind
 * الدلالية، بلا أي hex جديد. خادمي بالكامل عدا زر «رجوع للخلف».
 */
export default function NotFound() {
  return (
    <main
      dir="rtl"
      className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center text-foreground"
    >
      <div className="text-5xl text-gold" aria-hidden>⚑</div>

      <h1 className="mt-5 text-xl font-bold">ما لقينا هذي الصفحة</h1>
      <p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">
        يمكن الرابط قديم، أو الشي اللي تدوّره انحذف أو ما عاد لك صلاحية عليه.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          رجوع للرئيسية
        </Link>
        <BackButton className="rounded-xl border border-border px-6 py-3 text-sm font-semibold text-muted-foreground hover:text-foreground" />
      </div>

      <p className="mt-10 text-xs text-muted-foreground/70" dir="ltr">
        رقم فال REGA: 1200021029
      </p>
    </main>
  );
}
