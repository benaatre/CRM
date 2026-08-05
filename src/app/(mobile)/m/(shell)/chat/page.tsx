import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth-guards";
import { getChatPeers } from "@/lib/actions/chat";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { MobileChatPanel } from "@/components/mobile/chat-panel";

export const dynamic = "force-dynamic";

/** الشات الداخلي — نفس حارس الديسكتوب (requireUser) ونفس getChatPeers. */
export default async function MobileChatPage() {
  await requireUser();
  const peers = await getChatPeers();

  return (
    <div className="m-screen flex flex-col" style={{ gap: 13 }}>
      <div className="flex items-center" style={{ gap: 11 }}>
        <Link href="/m/more" aria-label="رجوع" className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, marginInlineStart: -10, color: MOBILE_COLORS.textPrimary }}>
          <ChevronLeft size={20} strokeWidth={2} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </Link>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>الشات الداخلي</h1>
          <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textMuted, marginTop: 3 }}>
            الفريق كله أو محادثة خاصة
          </div>
        </div>
      </div>
      <MobileChatPanel peers={peers} />
    </div>
  );
}
