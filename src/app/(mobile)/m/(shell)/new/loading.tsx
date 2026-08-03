import { MOBILE_COLORS } from "@/lib/mobile-tokens";

const bone = { backgroundColor: MOBILE_COLORS.card, boxSizing: "border-box" as const };

export default function Loading() {
  return (
    <div className="animate-pulse flex flex-col" style={{ gap: 12 }}>
      <div style={{ ...bone, height: 26, width: 140, borderRadius: 8 }} />
      <div className="flex" style={{ gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ ...bone, height: 34, width: 84, borderRadius: 17 }} />
        ))}
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ ...bone, height: 104, borderRadius: 16 }} />
      ))}
    </div>
  );
}
