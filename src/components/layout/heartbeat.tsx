"use client";

import { useEffect } from "react";

// يرسل نبضة كل دقيقتين لتحديث «آخر ظهور» (عتبة «متصل» ٥ دقائق فما تتأثر).
export function Heartbeat() {
  useEffect(() => {
    const ping = () => { fetch("/api/heartbeat", { method: "POST" }).catch(() => {}); };
    ping();
    const t = setInterval(ping, 120000);
    return () => clearInterval(t);
  }, []);
  return null;
}
