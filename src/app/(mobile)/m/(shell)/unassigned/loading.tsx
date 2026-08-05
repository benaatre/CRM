import { MOBILE_COLORS } from "@/lib/mobile-tokens";

const bone = { backgroundColor: MOBILE_COLORS.card, boxSizing: "border-box" as const };

export default function Loading() {
  return (
    <div className="animate-pulse flex flex-col" style={{ gap: 12 }}>
      <div style={{ ...bone, height: 26, width: 150, borderRadius: 8 }} />
      <div className="flex" style={{ gap: 9 }}>
        <div style={{ ...bone, height: 48, flex: 1, borderRadius: 13 }} />
        <div style={{ ...bone, height: 48, flex: 1, borderRadius: 13 }} />
      </div>
      <div className="grid grid-cols-3" style={{ gap: 9 }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ ...bone, height: 66, borderRadius: 14 }} />)}
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ ...bone, height: 60, borderRadius: 15 }} />
      ))}
    </div>
  );
}
