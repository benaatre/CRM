export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main
      dir="rtl"
      className="min-h-screen bg-[#0A0A0B] text-white flex flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <div className="text-[#CBA45E] text-5xl">⚑</div>
      <h1 className="text-xl font-bold">ما فيه اتصال بالإنترنت</h1>
      <p className="text-white/70">
        تحقّق من الشبكة وحاول مرة ثانية. البيانات تتحدّث أول ما يرجع الاتصال.
      </p>
      <p className="text-white/40 text-xs mt-6">رقم فال REGA: 1200021029</p>
    </main>
  );
}
