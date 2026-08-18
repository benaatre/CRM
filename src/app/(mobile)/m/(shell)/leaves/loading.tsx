import { MOBILE_COLORS } from "@/lib/mobile-tokens";

const bone = { backgroundColor: MOBILE_COLORS.card, boxSizing: "border-box" as const };

export default function Loading() {
  return (
    <div className="animate-pulse flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center justify-between">
        <div style={{ ...bone, height: 26, width: 120, borderRadius: 8 }} />
        <div style={{ ...bone, height: 36, width: 110, borderRadius: 12 }} />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ ...bone, height: 92, borderRadius: 14 }} />
      ))}
    </div>
  );
}
