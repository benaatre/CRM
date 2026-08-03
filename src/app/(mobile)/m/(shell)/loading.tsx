import { MOBILE_COLORS } from "@/lib/mobile-tokens";

const bone = { backgroundColor: MOBILE_COLORS.card, boxSizing: "border-box" as const };

/** هياكل عظمية بنفس أبعاد الرئيسية الحقيقية (ترويسة + بطاقات مجمّعة + قائمة). */
export default function MobileHomeLoading() {
  return (
    <div className="animate-pulse flex flex-col" style={{ gap: 16 }}>
      {/* الترويسة: عنوان + جرس وصورة رمزية ٤٢ */}
      <div className="flex items-start justify-between" style={{ padding: "0 2px" }}>
        <div className="flex-1">
          <div style={{ ...bone, height: 22, width: 170, borderRadius: 8 }} />
          <div style={{ ...bone, height: 13, width: 110, borderRadius: 6, marginTop: 8 }} />
        </div>
        <div className="flex" style={{ gap: 9 }}>
          <div style={{ ...bone, width: 42, height: 42, borderRadius: 14 }} />
          <div style={{ ...bone, width: 42, height: 42, borderRadius: 21 }} />
        </div>
      </div>

      {/* البطاقات المجمّعة */}
      <div className="flex flex-col" style={{ gap: 11 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ ...bone, height: 120, borderRadius: 18, opacity: 1 - i * 0.2 }} />
        ))}
      </div>

      {/* ابدأ بهذول */}
      <div>
        <div style={{ ...bone, height: 15, width: 90, borderRadius: 6, margin: "4px 2px 10px" }} />
        <div className="flex flex-col" style={{ gap: 10 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ ...bone, height: 104, borderRadius: 16 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
