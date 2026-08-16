"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { MobilePortal } from "@/components/mobile/portal";
import "./attendance.css";

/**
 * لوحة الدوام المنبثقة (وسط الشاشة) — `.sheetBack`/`.sheet` من المرجع حرفيًا.
 *
 * ⚠️ تُرندر عبر MobilePortal إلى <body>: صنف `.m-screen` يترك transform بعد
 * حركة الدخول فيصير الكتلة الحاوية لأي `fixed` تحته — بدون البوابة تظهر
 * اللوحة مقصوصة وغير متمركزة (نفس علة الورقة السفلية الموثقة في portal.tsx).
 *
 * قشرة عرض بحتة: الخلفية z-80 تعزل الصفحة وتُغلق باللمس، واللوحة z-85
 * متمركزة top/left 50% + translate(-50%,-50%) بعرض min(360px,90%) وحد أقصى
 * 90vh مع تمرير داخلي. تمرير الصفحة خلفها موقوف وهي مفتوحة. المحتوى كله من
 * بطاقة الدوام (children) — هنا صفر منطق وصفر نداءات.
 */
export function AttendancePanel({
  open,
  onClose,
  chip,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** شارة الحالة برأس اللوحة — نص ولون من البطاقة (نفس مصدر شارة الرأس). */
  chip: { label: string; color: string } | null;
  children: React.ReactNode;
}) {
  // قفل تمرير الصفحة خلف اللوحة — يرجع كما كان عند الإغلاق/التفكيك.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <MobilePortal>
      {/* ===== `.sheetBack` — تغطي الشاشة كاملة وتعزل المحتوى ===== */}
      <button
        type="button"
        aria-label="إغلاق اللوحة"
        onClick={onClose}
        className="m-panelback fixed inset-0 z-[80] border-0"
        style={{ background: "rgba(3, 3, 4, 0.78)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      />

      {/* ===== `.sheet` — متمركزة بنص الشاشة ===== */}
      <div
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-label="لوحة الدوام"
        className="att-scope m-panelin fixed z-[85] overflow-y-auto"
        style={{
          top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: "min(360px, 90%)", maxHeight: "90vh",
          borderRadius: 26, border: "1px solid var(--m-acc-a32)",
          background: "radial-gradient(130% 80% at 50% 0%, var(--m-sheet), var(--m-card))",
        }}
      >
        {/* خيط التوهّج العلوي `::before` */}
        <span
          aria-hidden
          style={{
            position: "absolute", insetInline: 0, top: 0, height: 1,
            background: "linear-gradient(90deg, transparent, var(--m-acc-a32), transparent)",
          }}
        />

        {/* ===== الرأس `.shead`: شارة الحالة + إغلاق 30px ===== */}
        <div className="flex items-center justify-between" style={{ padding: "20px 20px 6px" }}>
          {chip ? (
            <span
              className="inline-flex items-center"
              style={{
                gap: 7, fontSize: 12, fontWeight: 600, color: chip.color,
                background: `color-mix(in srgb, ${chip.color} 14%, transparent)`,
                borderRadius: 9, padding: "6px 11px",
              }}
            >
              <span aria-hidden className="att-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
              {chip.label}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex items-center justify-center"
            style={{
              width: 30, height: 30, borderRadius: 10,
              background: "var(--m-border)", color: "var(--m-text2)",
              border: "none",
            }}
          >
            <X aria-hidden size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex flex-col" style={{ gap: 12, padding: "6px 16px 18px" }}>{children}</div>
      </div>
    </MobilePortal>
  );
}

export default AttendancePanel;
