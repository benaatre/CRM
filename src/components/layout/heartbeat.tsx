"use client";

import { useEffect } from "react";

// يرسل نبضة كل دقيقة لتحديث «آخر ظهور».
export function Heartbeat() {
  useEffect(() => {
    const ping = () => { fetch("/api/heartbeat", { method: "POST" }).catch(() => {}); };
    ping();
    const t = setInterval(ping, 60000);
    return () => clearInterval(t);
  }, []);
  return null;
}
