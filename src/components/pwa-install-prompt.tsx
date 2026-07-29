"use client";
import { useEffect, useState } from "react";

// حدث beforeinstallprompt غير معرّف في أنواع DOM القياسية — نعرّفه يدويًا.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);
  if (!show) return null;
  return (
    <div
      dir="rtl"
      className="fixed bottom-4 inset-x-4 z-50 rounded-2xl bg-[#141416] border border-[#CBA45E]/30 p-4 flex items-center justify-between gap-3 shadow-xl"
    >
      <span className="text-white text-sm">ثبّت تطبيق السلطان على جهازك</span>
      <div className="flex gap-2">
        <button onClick={() => setShow(false)} className="text-white/50 text-sm px-2">
          لاحقًا
        </button>
        <button
          onClick={async () => {
            await deferred?.prompt?.();
            setShow(false);
          }}
          className="bg-[#CBA45E] text-[#0A0A0B] text-sm font-bold rounded-lg px-4 py-2"
        >
          تثبيت
        </button>
      </div>
    </div>
  );
}
