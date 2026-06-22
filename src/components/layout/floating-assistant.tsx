"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Loader2 } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

const suggestions = [
  "وش أكثر قناة جايبة عملاء؟",
  "مين أفضل موظف هذا الشهر؟",
  "كم عميل ما اتواصلنا معه؟",
  "وش وضع التحصيل والعرابين؟",
];

const STORE_KEY = "assistantChat";

export function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const s = sessionStorage.getItem(STORE_KEY); if (s) setMsgs(JSON.parse(s)); } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(msgs)); } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const history = msgs.slice(-8);
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      const data = await res.json();
      setMsgs((m) => [...m, { role: "assistant", content: res.ok ? (data.answer ?? "—") : (data.error ?? "صار خطأ") }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "تعذّر الاتصال بالمساعد" }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* الأيقونة العائمة */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="مساعد كلود"
        className="fixed bottom-6 right-6 z-[65] flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-gold to-gold-dark text-primary-foreground shadow-2xl transition-transform hover:scale-105"
      >
        {open ? <X className="size-6" /> : <Sparkles className="size-6" />}
      </button>

      {open && (
        <aside className="fixed bottom-24 right-6 z-[65] flex h-[28rem] w-[22rem] max-w-[calc(100vw-3rem)] flex-col rounded-2xl border border-border bg-card shadow-2xl">
          <header className="flex items-center gap-2 border-b border-border p-4">
            <Sparkles className="size-5 text-gold" />
            <div>
              <div className="text-sm font-bold text-foreground">مساعد كلود</div>
              <div className="text-xs text-muted-foreground">يعرف بيانات نظامك</div>
            </div>
            {msgs.length > 0 && <button onClick={() => setMsgs([])} className="mr-auto text-xs text-muted-foreground hover:text-foreground">مسح</button>}
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">اسألني عن عملائك ومبيعاتك:</p>
                {suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)} className="block w-full rounded-lg border border-border px-3 py-2 text-right text-xs text-muted-foreground hover:border-gold/40 hover:text-foreground">{s}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-background text-foreground"}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && <div className="flex justify-end"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-border p-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="اكتب سؤالك…" className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold" />
            <button type="submit" disabled={loading} className="rounded-xl bg-primary px-3 text-primary-foreground hover:opacity-90 disabled:opacity-50"><Send className="size-4" /></button>
          </form>
        </aside>
      )}
    </>
  );
}
