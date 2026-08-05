"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { MobileNewLeadSheet } from "@/components/mobile/new-lead-sheet";

type Employee = { id: string; name: string };

/** زر «عميل جديد» بجانب البحث — نفس زر ترويسة شاشة عملاء الديسكتوب، يفتح الورقة. */
export function MobileNewLeadButton({ isManager, employees }: { isManager: boolean; employees: Employee[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="عميل جديد"
        className="m-iconbtn flex flex-none items-center justify-center"
        style={{
          boxSizing: "border-box", width: 44, height: 44, borderRadius: 13, border: "none",
          background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, cursor: "pointer",
        }}
      >
        <Plus size={20} strokeWidth={2.2} aria-hidden />
      </button>
      <MobileNewLeadSheet open={open} onClose={() => setOpen(false)} isManager={isManager} employees={employees} />
    </>
  );
}

export default MobileNewLeadButton;
