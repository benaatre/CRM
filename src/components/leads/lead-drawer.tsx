"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActivityType, LeadStage, Priority } from "@prisma/client";
import {
  X,
  Phone,
  MessageCircle,
  MapPin,
  CalendarClock,
  StickyNote,
  Loader2,
} from "lucide-react";
import {
  stageOrder,
  stageLabels,
  stageColor,
  channelLabel,
  priorityLabels,
  activityTypeLabel,
  activityTypeLabels,
} from "@/lib/labels";
import { formatCurrencyFull, formatDate, timeAgo } from "@/lib/format";
import type { LeadDetail } from "@/lib/data/leads";
import {
  fetchLeadDetail,
  updateLeadStage,
  updateLeadFields,
  addActivity,
  reassignLead,
} from "@/lib/actions/leads";

type Employee = { id: string; name: string };

const activityButtons: { type: ActivityType; label: string; icon: typeof Phone }[] = [
  { type: "CALL", label: "اتصال", icon: Phone },
  { type: "WHATSAPP", label: "واتساب", icon: MessageCircle },
  { type: "VISIT", label: "زيارة", icon: MapPin },
  { type: "APPOINTMENT", label: "موعد", icon: CalendarClock },
  { type: "NOTE", label: "ملاحظة", icon: StickyNote },
];

export function LeadDrawer({
  leadId,
  onClose,
  isManager,
  employees,
}: {
  leadId: string | null;
  onClose: () => void;
  isManager: boolean;
  employees: Employee[];
}) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [actType, setActType] = useState<ActivityType>("CALL");
  const [note, setNote] = useState("");

  async function load(id: string) {
    setLoading(true);
    const data = await fetchLeadDetail(id);
    setLead(data);
    setLoading(false);
  }

  useEffect(() => {
    if (leadId) load(leadId);
    else setLead(null);
  }, [leadId]);

  function refresh() {
    if (leadId) load(leadId);
    router.refresh();
  }

  if (!leadId) return null;

  return (
    <>
      {/* خلفية معتمة */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* اللوحة (تنزلق من اليسار في RTL) */}
      <aside className="fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl">
        {loading && !lead ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : !lead ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-muted-foreground">العميل غير موجود أو ما عندك صلاحية عليه.</p>
            <button onClick={onClose} className="text-sm text-gold">إغلاق</button>
          </div>
        ) : (
          <>
            {/* الرأس */}
            <header className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-lg font-bold text-foreground">{lead.name}</h2>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <span dir="ltr">{lead.phone}</span>
                  <a
                    href={`https://wa.me/966${lead.phone.replace(/^0/, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-success hover:underline"
                  >
                    واتساب
                  </a>
                </div>
                <span
                  className={`mt-2 inline-block rounded-full border px-2.5 py-0.5 text-xs ${stageColor[lead.stage]}`}
                >
                  {stageLabels[lead.stage]}
                </span>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {/* معلومات سريعة */}
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Info label="القناة" value={channelLabel(lead.channel)} />
                <Info label="الميزانية" value={formatCurrencyFull(lead.budget)} />
                <Info label="الموظف" value={lead.assignedTo?.name ?? "—"} />
                <Info label="المشروع" value={lead.projectName ?? "—"} />
                <Info label="المحاولات" value={String(lead.attempts)} />
                <Info label="أُضيف" value={formatDate(lead.createdAt)} />
                <Info label="آخر تواصل" value={lead.lastContact ? formatDate(lead.lastContact) : "—"} />
                <Info label="المتابعة" value={lead.nextFollowup ? formatDate(lead.nextFollowup) : "—"} />
              </dl>

              {/* أدوات سريعة */}
              <div className="space-y-3 rounded-xl border border-border p-4">
                <Control label="المرحلة">
                  <select
                    value={lead.stage}
                    disabled={pending}
                    onChange={(e) =>
                      startTransition(async () => {
                        await updateLeadStage(lead.id, e.target.value as LeadStage);
                        refresh();
                      })
                    }
                    className="select-base"
                  >
                    {stageOrder.map((s) => (
                      <option key={s} value={s}>{stageLabels[s]}</option>
                    ))}
                  </select>
                </Control>

                <Control label="الأولوية">
                  <select
                    value={lead.priority}
                    disabled={pending}
                    onChange={(e) =>
                      startTransition(async () => {
                        await updateLeadFields(lead.id, { priority: e.target.value as Priority });
                        refresh();
                      })
                    }
                    className="select-base"
                  >
                    {(Object.keys(priorityLabels) as Priority[]).map((p) => (
                      <option key={p} value={p}>{priorityLabels[p]}</option>
                    ))}
                  </select>
                </Control>

                {isManager && (
                  <Control label="إسناد إلى">
                    <select
                      value={lead.assignedTo?.id ?? ""}
                      disabled={pending}
                      onChange={(e) =>
                        startTransition(async () => {
                          await reassignLead(lead.id, e.target.value);
                          refresh();
                        })
                      }
                      className="select-base"
                    >
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                    </select>
                  </Control>
                )}
              </div>

              {/* تسجيل متابعة */}
              <div className="space-y-3 rounded-xl border border-border p-4">
                <div className="text-sm font-medium text-foreground">سجّل متابعة</div>
                <div className="flex flex-wrap gap-1.5">
                  {activityButtons.map((b) => {
                    const Icon = b.icon;
                    return (
                      <button
                        key={b.type}
                        type="button"
                        onClick={() => setActType(b.type)}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                          actType === b.type
                            ? "border-gold/50 bg-gold/10 text-gold"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon className="size-3.5" />
                        {b.label}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="تفاصيل المتابعة (اختياري)…"
                  rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-gold"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await addActivity(lead.id, actType, note);
                      setNote("");
                      refresh();
                    })
                  }
                  className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "جارٍ الحفظ…" : `سجّل ${activityTypeLabel(actType)}`}
                </button>
              </div>

              {/* السجل الزمني */}
              <div>
                <div className="mb-3 text-sm font-medium text-foreground">
                  سجل المتابعات ({lead.activities.length})
                </div>
                {lead.activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">ما فيه متابعات بعد.</p>
                ) : (
                  <ol className="relative space-y-4 border-r border-border pr-4">
                    {lead.activities.map((a) => (
                      <li key={a.id} className="relative">
                        <span className="absolute -right-[1.30rem] top-1.5 size-2 rounded-full bg-gold" />
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">
                            {activityTypeLabels[a.type]}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {timeAgo(a.createdAt)}
                          </span>
                        </div>
                        {a.note && <p className="mt-0.5 text-sm text-muted-foreground">{a.note}</p>}
                        {a.userName && (
                          <p className="mt-0.5 text-xs text-muted-foreground/70">{a.userName}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-[55%]">{children}</span>
    </label>
  );
}
