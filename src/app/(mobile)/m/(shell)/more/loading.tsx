import { MOBILE_COLORS } from "@/lib/mobile-tokens";

const bone = { backgroundColor: MOBILE_COLORS.card, boxSizing: "border-box" as const };

export default function Loading() {
  return (
    <div className="animate-pulse flex flex-col" style={{ gap: 13 }}>
      <div style={{ ...bone, height: 26, width: 90, borderRadius: 8 }} />
      <div style={{ ...bone, height: 76, borderRadius: 16 }} />
      <div className="grid grid-cols-2" style={{ gap: 9 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ ...bone, height: 104, borderRadius: 16 }} />
        ))}
      </div>
    </div>
  );
}
