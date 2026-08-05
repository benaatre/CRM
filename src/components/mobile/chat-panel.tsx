"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import {
  getChatMessages, sendChatMessage,
  type ChatMessageDTO, type ChatPeer,
} from "@/lib/actions/chat";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";

/** نفس فترة تحديث الديسكتوب حرفيًا (chat-view.tsx: POLL_MS = 5000). */
const POLL_MS = 5000;

/**
 * الشات الداخلي — غلاف جوال لنفس أكشنات الديسكتوب (getChatMessages/sendChatMessage)
 * وبنفس آلية التحديث (polling كل ٥ ثوانٍ) — لا realtime جديد.
 */
export function MobileChatPanel({ peers }: { peers: ChatPeer[] }) {
  // null = الشات العام (نفس دلالة peerId في الأكشن).
  const [peerId, setPeerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // تحميل + polling على المحادثة النشطة — نفس نمط الديسكتوب.
  useEffect(() => {
    let alive = true;
    const load = () =>
      getChatMessages(peerId)
        .then((rows) => { if (alive) setMessages(rows); })
        .catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [peerId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, peerId]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await sendChatMessage(text, peerId);
      if (r && typeof r === "object" && "ok" in r && !r.ok) {
        setError(("error" in r ? (r.error as string) : null) ?? "تعذّر الإرسال");
      } else {
        setBody("");
        const rows = await getChatMessages(peerId);
        setMessages(rows);
      }
    } catch {
      setError("تعذّر الإرسال — جرّب ثانية");
    }
    setSending(false);
  };

  return (
    <div className="flex flex-col" style={{ gap: 11 }}>
      {/* ===== المحادثات: العام + الزملاء ===== */}
      <div className="m-noscroll flex overflow-x-auto" style={{ gap: 7, paddingBottom: 2 }}>
        <button type="button" onClick={() => setPeerId(null)}
          className="flex flex-none items-center"
          style={{
            boxSizing: "border-box", height: 34, padding: "0 14px", borderRadius: 17, fontSize: "12.5px", fontWeight: 600,
            ...(peerId === null
              ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
              : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
          }}>
          الفريق كله
        </button>
        {peers.map((p) => (
          <button key={p.id} type="button" onClick={() => setPeerId(p.id)}
            className="flex flex-none items-center"
            style={{
              boxSizing: "border-box", height: 34, padding: "0 14px", borderRadius: 17, fontSize: "12.5px", fontWeight: 600, gap: 6,
              ...(peerId === p.id
                ? { background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }
                : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
            }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: p.online ? MOBILE_STATUS.success.base : MOBILE_COLORS.dim2 }} />
            {p.name}
          </button>
        ))}
      </div>

      {/* ===== الرسائل ===== */}
      <div className="m-noscroll flex flex-col"
        style={{
          boxSizing: "border-box", gap: 8, minHeight: 260, maxHeight: "52dvh", overflowY: "auto",
          background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
          borderRadius: 16, padding: 12,
        }}>
        {messages.length === 0 ? (
          <p className="m-auto" style={{ fontSize: "12.5px", color: MOBILE_COLORS.textMuted }}>
            ما فيه رسائل بعد — ابدأ المحادثة
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex flex-col"
              style={{
                boxSizing: "border-box", maxWidth: "82%", borderRadius: 13, padding: "8px 11px",
                alignSelf: m.mine ? "flex-start" : "flex-end",
                background: m.mine ? MOBILE_COLORS.goldBg : MOBILE_COLORS.sheet,
                border: `1px solid ${m.mine ? MOBILE_COLORS.goldBorder : MOBILE_COLORS.border}`,
              }}>
              {!m.mine && (
                <span style={{ fontSize: "10.5px", fontWeight: 700, color: MOBILE_COLORS.gold, marginBottom: 3 }}>
                  {m.senderName}
                </span>
              )}
              <span style={{ fontSize: 13, color: MOBILE_COLORS.textPrimary, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {m.body}
              </span>
              <span style={{ fontSize: 10, color: MOBILE_COLORS.textMuted, marginTop: 4 }}>
                {new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).format(new Date(m.createdAt))}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p style={{ boxSizing: "border-box", borderRadius: 10, padding: "8px 12px", fontSize: 12, background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.fg }}>
          {error}
        </p>
      )}

      {/* ===== الإدخال ===== */}
      <div className="flex items-end" style={{ gap: 8 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={peerId ? "رسالة خاصة…" : "رسالة للفريق…"}
          rows={1}
          style={{
            boxSizing: "border-box", flex: 1, minHeight: 44, maxHeight: 120, resize: "none",
            background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
            borderRadius: 13, padding: "11px 13px", fontSize: 13, color: MOBILE_COLORS.textPrimary, outline: "none",
          }}
        />
        <button type="button" onClick={send} disabled={sending || !body.trim()} aria-label="إرسال"
          className="flex flex-none items-center justify-center"
          style={{
            boxSizing: "border-box", width: 44, height: 44, borderRadius: 13, border: "none",
            background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
            opacity: sending || !body.trim() ? 0.5 : 1,
          }}>
          <Send size={18} style={{ transform: "scaleX(-1)" }} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export default MobileChatPanel;
