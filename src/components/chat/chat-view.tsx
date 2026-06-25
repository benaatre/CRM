"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Users, Send } from "lucide-react";
import { toArabicDigits } from "@/lib/format";
import {
  getChatMessages, sendChatMessage,
  type ChatMessageDTO, type ChatPeer,
} from "@/lib/actions/chat";

const POLL_MS = 5000;

function timeLabel(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return toArabicDigits(`${hh}:${mm}`);
}

export function ChatView({
  currentUserId, currentUserName, peers,
}: {
  currentUserId: string;
  currentUserName: string;
  peers: ChatPeer[];
}) {
  // null = الشات الجماعي · otherwise معرّف الموظف للشات الخاص
  const [activePeer, setActivePeer] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activePeerRef = useRef<string | null>(null);
  activePeerRef.current = activePeer;

  const peer = peers.find((p) => p.id === activePeer) ?? null;
  const title = activePeer ? peer?.name ?? "محادثة" : "الشات الجماعي";

  // تحميل + polling كل ٥ ثوانٍ على المحادثة النشطة.
  useEffect(() => {
    let alive = true;
    async function load() {
      const data = await getChatMessages(activePeer);
      if (alive && activePeerRef.current === activePeer) setMessages(data);
    }
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [activePeer]);

  // التمرير لأسفل عند وصول رسائل جديدة.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    // تفاؤلي
    const optimistic: ChatMessageDTO = {
      id: `tmp-${messages.length}`, body, senderId: currentUserId,
      senderName: currentUserName, mine: true, createdAt: new Date(),
    };
    setMessages((m) => [...m, optimistic]);
    startTransition(async () => {
      await sendChatMessage(body, activePeer);
      setMessages(await getChatMessages(activePeer));
    });
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-9rem)] max-w-5xl gap-4">
      {/* قائمة المحادثات — سطح المكتب */}
      <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card md:flex">
        <div className="border-b border-border p-3 text-sm font-semibold text-foreground">المحادثات</div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          <ChatTab active={activePeer === null} onClick={() => setActivePeer(null)}>
            <Users className="size-4" /> الشات الجماعي
          </ChatTab>
          <div className="px-2 pb-1 pt-3 text-xs text-muted-foreground">رسائل خاصة</div>
          {peers.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">ما فيه موظفين.</p>}
          {peers.map((p) => (
            <ChatTab key={p.id} active={activePeer === p.id} onClick={() => setActivePeer(p.id)}>
              <span className={`size-2 shrink-0 rounded-full ${p.online ? "bg-success" : "bg-muted-foreground/40"}`} />
              <span className="truncate">{p.name}</span>
            </ChatTab>
          ))}
        </div>
      </aside>

      {/* لوحة المحادثة */}
      <section className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <span className="font-semibold text-foreground">{title}</span>
          {/* مبدّل المحادثات — الجوال */}
          <select
            value={activePeer ?? ""}
            onChange={(e) => setActivePeer(e.target.value || null)}
            className="select-base ml-auto w-auto md:hidden"
          >
            <option value="">الشات الجماعي</option>
            {peers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">ابدأ المحادثة — لا توجد رسائل بعد.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                  {activePeer === null && !m.mine && <div className="mb-0.5 text-xs font-medium text-gold">{m.senderName}</div>}
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={`mt-0.5 text-[0.65rem] ${m.mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{timeLabel(m.createdAt)}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={send} className="flex items-center gap-2 border-t border-border p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="اكتب رسالة…"
            className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-gold"
          />
          <button type="submit" disabled={pending || !text.trim()} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            <Send className="size-4" /> إرسال
          </button>
        </form>
      </section>
    </div>
  );
}

function ChatTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-right text-sm transition-colors ${active ? "bg-secondary text-gold" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}
