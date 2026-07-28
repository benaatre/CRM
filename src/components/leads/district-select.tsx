"use client";

/**
 * حقل «في أي حي تفضّل التملك؟» — مكوّن اختيار واحد مشترك بين درج العميل الكامل
 * والدرج الجانبي وفورم «عميل جديد». يكتب على preferredAreas حصرًا.
 *
 * التخزين بالقيم الطويلة («الرياض المهدية») والعرض بالاسم القصير — انظر lib/districts.
 * زر «الأحياء الثلاثة تناسبني» اختصار يحدّد الثلاثة معًا؛ التخزين يبقى الأحياء الفعلية.
 * القيم القديمة الحرة (كتابة حرة/استيراد قديم) لا تُمس: تُعرض كما هي مع إمكانية حذفها فقط.
 */

import {
  ALL_AREAS, ALL_AREAS_LABEL, DISTRICT_OPTIONS, DISTRICT_QUESTION,
  canonicalAreas, hasAllAreas,
} from "@/lib/districts";

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs transition-colors ${
    active ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:text-foreground"
  }`;

export function DistrictSelect({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const all = hasAllAreas(value);
  // القيم القديمة الحرة — تمرّ كما هي في كل تبديل حتى لا يمسحها ضغط زر.
  const legacy = value.filter((v) => !ALL_AREAS.includes(v));

  function toggle(area: string) {
    onChange(canonicalAreas(value.includes(area) ? value.filter((v) => v !== area) : [...value, area]));
  }
  function toggleAll() {
    onChange(canonicalAreas(all ? legacy : [...ALL_AREAS, ...legacy]));
  }

  return (
    <div className="space-y-2">
      <span className="text-xs text-muted-foreground">{DISTRICT_QUESTION}</span>
      <div className="flex flex-wrap gap-1.5">
        {DISTRICT_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => toggle(o.value)}
            className={chip(value.includes(o.value))}
          >
            {o.label}
          </button>
        ))}
        <button type="button" disabled={disabled} onClick={toggleAll} className={chip(all)}>
          {ALL_AREAS_LABEL}
        </button>
      </div>
      {legacy.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">قيم قديمة:</span>
          {legacy.map((a) => (
            <span key={a} className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
              {a}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(canonicalAreas(value.filter((v) => v !== a)))}
                className="text-muted-foreground hover:text-destructive"
                aria-label="حذف"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
