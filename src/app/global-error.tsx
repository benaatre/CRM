"use client";

// حارس أعطال تحميل الأجزاء (ChunkLoadError) على مستوى الجذر.
// بعد أي نشر، المتصفّح قد يكون فاتحًا صفحة قديمة تشير إلى chunk اتحذف من الخادم،
// فيطلع ChunkLoadError. هنا نلتقطه ونعيد التحميل مرّة واحدة تلقائيًا — مع حارس
// زمني في sessionStorage يمنع حلقة إعادة تحميل لا نهائية لو استمر العطل.
import { useEffect } from "react";

const RELOAD_KEY = "chunk-reload-at";
const RELOAD_COOLDOWN_MS = 10_000; // لو أعدنا التحميل خلال آخر ١٠ ثوانٍ، ما نكرّر

function isChunkLoadError(error?: Error): boolean {
  if (!error) return false;
  const text = `${error.name} ${error.message}`;
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    text
  );
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    if (!chunkError) return;
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      if (Date.now() - last < RELOAD_COOLDOWN_MS) return; // أعدنا التحميل قبل شوي — نوقف الحلقة
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      // sessionStorage غير متاح — نعيد التحميل مرّة على أي حال
    }
    location.reload();
  }, [chunkError]);

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0b",
          color: "#ededf0",
          fontFamily:
            "'IBM Plex Sans Arabic', system-ui, -apple-system, Segoe UI, sans-serif",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: "420px",
            width: "100%",
            textAlign: "center",
            backgroundColor: "#141417",
            border: "1px solid #2a2a30",
            borderRadius: "16px",
            padding: "32px 24px",
          }}
        >
          {chunkError ? (
            <>
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔄</div>
              <h1 style={{ fontSize: "20px", fontWeight: 600, margin: "0 0 8px" }}>
                نحدّث النسخة…
              </h1>
              <p style={{ color: "#9a9aa3", margin: 0, lineHeight: 1.7 }}>
                نزل تحديث جديد للنظام. نعيد تحميل الصفحة لك الحين تلقائيًا.
              </p>
            </>
          ) : (
            <>
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>⚠️</div>
              <h1 style={{ fontSize: "20px", fontWeight: 600, margin: "0 0 8px" }}>
                صار خطأ غير متوقّع
              </h1>
              <p style={{ color: "#9a9aa3", margin: "0 0 20px", lineHeight: 1.7 }}>
                حصل خلل بسيط. جرّب مرّة ثانية، ولو تكرّر كلّم الدعم.
              </p>
              <button
                onClick={() => reset()}
                style={{
                  backgroundColor: "#cba45e",
                  color: "#0a0a0b",
                  border: "none",
                  borderRadius: "10px",
                  padding: "10px 24px",
                  fontSize: "15px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                جرّب مرّة ثانية
              </button>
            </>
          )}
        </div>
      </body>
    </html>
  );
}
