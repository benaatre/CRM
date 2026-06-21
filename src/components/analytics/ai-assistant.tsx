"use client";

import { useState } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";

const suggestions = [
  "كم عميل عندي ينتظر أول تواصل؟",
  "وش أكثر قناة جايبة عملاء؟",
  "كم معدل التحويل عندي؟",
  "وش وضع التحصيل والعرابين؟",
];

export function AiAssistant() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      if (!res.ok) setError(data?.error ?? "صار خطأ");
      else setAnswer(data.answer);
    } catch {
      setError("تعذّر الاتصال بالمساعد");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-5 text-gold" />
        <div>
          <h2 className="font-semibold text-foreground">اسأل بياناتك</h2>
          <p className="text-xs text-muted-foreground">مساعد ذكي يجاوب على أسئلتك عن أرقامك</p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="اكتب سؤالك… مثلًا: كم صفقة قفلت هالشهر؟"
          className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-gold"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          اسأل
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => {
              setQ(s);
              ask(s);
            }}
            disabled={loading}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      {answer && (
        <div className="mt-4 whitespace-pre-wrap rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
          {answer}
        </div>
      )}
    </section>
  );
}
