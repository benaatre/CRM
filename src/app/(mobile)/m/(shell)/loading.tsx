import { MOBILE_COLORS } from "@/lib/mobile-tokens";

const bone = { backgroundColor: MOBILE_COLORS.card } as const;

/** هياكل عظمية بنفس أبعاد الشاشة الحقيقية — فلا تقفز الواجهة عند وصول البيانات. */
export default function MobileHomeLoading() {
  return (
    <div className="animate-pulse">
      {/* الترويسة */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex-1">
          <div className="h-4 w-40 rounded" style={bone} />
          <div className="mt-2 h-3 w-24 rounded" style={bone} />
        </div>
        <div className="size-[34px] shrink-0 rounded-full" style={bone} />
      </div>

      {/* العدّادات */}
      <div className="flex gap-[7px] px-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[62px] flex-1 rounded-[10px]" style={bone} />
        ))}
      </div>

      {/* القائمة */}
      <div className="mt-5 px-4">
        <div className="mb-2 h-3 w-20 rounded" style={bone} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-2 h-[104px] rounded-xl" style={bone} />
        ))}
      </div>
    </div>
  );
}
