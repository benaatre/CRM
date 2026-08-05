import { MOBILE_COLORS } from "@/lib/mobile-tokens";

const bone = { backgroundColor: MOBILE_COLORS.card, boxSizing: "border-box" as const };

export default function Loading() {
  return (
    <div className="animate-pulse flex flex-col" style={{ gap: 12 }}>
      <div style={{ ...bone, height: 26, width: 140, borderRadius: 8 }} />
      {[0, 1].map((i) => (
        <div key={i} style={{ ...bone, height: 180, borderRadius: 16 }} />
      ))}
    </div>
  );
}
