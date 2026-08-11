"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeadStage, Channel, FollowUpResult, PurchaseGoal, PurchaseMethod, ActivityType } from "@prisma/client";
import { STAGE_HEX, stageChipClass } from "@/lib/stage-colors";
import {
  stageLabel, activityTypeLabels, followUpResultLabels,
  purchaseGoalLabels, purchaseMethodOptions, purchaseMethodLabels,
} from "@/lib/labels";
import { MOBILE_COLORS } from "@/lib/mobile-tokens";
import { toArabicDigits, elapsedLabel } from "@/lib/mobile-format";
import { avatarInitials } from "@/lib/mobile-avatar";
import { waPhone } from "@/lib/value-normalize";
import { markCall } from "@/lib/mobile-call-tracker";
import { updateLeadIntake } from "@/lib/actions/leads";
import { fetchSources } from "@/lib/actions/sources";
import type { SourceListItem } from "@/lib/data/sources";
import { NI_REASONS, buildNotInterestedBody } from "@/components/leads/not-interested-dialog";
import { buildBody, buildFirstContactBody, type SaveBody } from "@/lib/mobile-followup";
import { DistrictSelect } from "@/components/leads/district-select";
import { FollowupSheet } from "@/components/mobile/followup-sheet";
import { EditFollowupSheet, editMinutesLeft } from "@/components/mobile/edit-followup-sheet";

/**
 * ملف العميل v3 — نسخة الموظف (المرحلة د): hero + تبويبا «بيانات» و«المتابعة والزيارات»
 * + تدفق أول التواصل الإلزامي + الخط الزمني المعرّب بفلترة خصوصية الموظف + شريط سفلي ثابت.
 * عرض وتغليف خالص: الحفظ عبر updateLeadDetails وPOST/PATCH المتابعات القائمة حرفيًا.
 */



export type ProfileFu = { id: string; result: FollowUpResult; note: string | null; nextDate: Date | null; createdAt: Date; userName: string | null };
export type ProfileAct = { id: string; type: ActivityType; note: string | null; createdAt: Date; userName: string | null };

export type ProfileData = {
  id: string;
  name: string;
  phone: string;
  stage: LeadStage;
  channel: Channel;
  assignedAt: Date | null;
  lastContact: Date | null;
  nextFollowup: Date | null;
  visitAt: Date | null;
  followUpsCount: number;
  firstContact: boolean;
  purchaseGoal: PurchaseGoal | null;
  purchaseMethod: PurchaseMethod | null;
  priceMin: number | null;
  priceMax: number | null;
  sourceId: string | null;
  preferredAreas: string[];
  preferredProjects: string[];
  followUps: ProfileFu[];
  activities: ProfileAct[];
};

function fmtDT(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** لون نقطة المتابعة — نفس تصنيف الخط الزمني v2. */
function fuTone(result: FollowUpResult): string {
  if (result.startsWith("NOT_INTERESTED")) return MOBILE_COLORS.rose;
  if (result.startsWith("NOT_ANSWERED") || result === "NO_ANSWER_INTERESTED" || result === "CALL_LATER") return MOBILE_COLORS.sky;
  if (result === "ON_HOLD" || result === "BANK_CHECK" || result === "NEGOTIATING" || result === "VISIT_NO_SHOW_RESCHEDULED") return MOBILE_COLORS.amber;
  return MOBILE_COLORS.mint;
}

const box = {
  boxSizing: "border-box" as const,
  background: MOBILE_COLORS.card,
  border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 16,
};
const fieldStyle = {
  boxSizing: "border-box" as const,
  width: "100%", minHeight: 44,
  background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`,
  borderRadius: 10, padding: "0 12px", fontSize: 13, color: MOBILE_COLORS.textPrimary, outline: "none",
};
const chip = (on: boolean, base: string = MOBILE_COLORS.gold, bg: string = MOBILE_COLORS.goldBg, bd: string = MOBILE_COLORS.goldBorder) => ({
  boxSizing: "border-box" as const, minHeight: 40, padding: "0 13px", borderRadius: 11,
  fontSize: "12.5px", fontWeight: 600 as const,
  ...(on ? { background: bg, color: base, border: `1px solid ${bd}` } : { background: MOBILE_COLORS.card, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
});

export function LeadProfileV3({
  lead, projects, falLicense,
}: {
  lead: ProfileData;
  projects: { id: string; name: string }[];
  falLicense: string | null;
}) {
  const [tab, setTab] = useState<"data" | "fu">("fu");
  const [fuOpen, setFuOpen] = useState<null | { key: string | null }>(null);
  const [editFu, setEditFu] = useState<ProfileFu | null>(null);
  const nowMs = Date.now();

  const heroLine = lead.firstContact
    ? "استلمته اليوم · ينتظر أول تواصل"
    : `عميلك من ${lead.assignedAt ? elapsedLabel(lead.assignedAt, new Date(nowMs)) : "—"} · ${lead.lastContact ? `آخر تواصل قبل ${elapsedLabel(lead.lastContact, new Date(nowMs))}` : "لا تواصل مسجّل"}`;

  // الخط الزمني المدمج (متابعات + أنشطة) — فلترة خصوصية الموظف:
  // أحداث الإسناد تُعرض بنص عام موحّد بلا تفاصيل إدارية (توزيع/سحب/من كان معه).
  const timeline = useMemo(() => {
    return [
      ...lead.followUps.map((f) => ({ kind: "fu" as const, at: f.createdAt, f })),
      ...lead.activities.map((a) => ({ kind: "act" as const, at: a.createdAt, a })),
    ].sort((x, y) => y.at.getTime() - x.at.getTime());
  }, [lead.followUps, lead.activities]);

  return (
    <div className="m-screen flex flex-col" style={{ gap: 14, paddingBottom: 88 }}>
      {/* ===== الترويسة: رجوع ===== */}
      <Link href="/m/leads" className="flex items-center" style={{ minHeight: 40, gap: 5, color: MOBILE_COLORS.textSecondary, fontSize: 13 }}>
        → رجوع
      </Link>

      {/* ===== hero ===== */}
      <div className="relative overflow-hidden" style={{ ...box, borderRadius: 18, padding: "15px 15px" }}>
        <span aria-hidden style={{ position: "absolute", top: 0, insetInline: 12, height: 2, borderRadius: 2, background: STAGE_HEX[lead.stage], boxShadow: `0 0 12px ${STAGE_HEX[lead.stage]}` }} />
        <div className="flex items-center" style={{ gap: 12 }}>
          <span className="flex flex-none items-center justify-center" style={{ width: 58, height: 58, borderRadius: 29, fontSize: 19, fontWeight: 800, background: STAGE_HEX[lead.stage], color: MOBILE_COLORS.bg }}>
            {avatarInitials(lead.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center" style={{ gap: 7 }}>
              <span className="min-w-0 truncate" style={{ fontSize: 19, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>{lead.name}</span>
              <span className={`flex-none whitespace-nowrap border font-semibold ${stageChipClass[lead.stage]}`} style={{ fontSize: "10.5px", padding: "4px 9px", borderRadius: 7 }}>
                {stageLabel(lead.stage)}
              </span>
            </div>
            <div dir="ltr" className="truncate text-right" style={{ fontSize: 13, color: MOBILE_COLORS.textMuted, marginTop: 3 }}>{lead.phone}</div>
            <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary, marginTop: 4 }}>{heroLine}</div>
          </div>
        </div>
        <div className="flex" style={{ gap: 8, marginTop: 12 }}>
          <a href={`tel:${lead.phone}`} onClick={() => markCall(lead.id)}
            className="m-press flex flex-1 items-center justify-center"
            style={{ boxSizing: "border-box", height: 46, borderRadius: 12, border: "none", background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700, gap: 6 }}>
            📞 اتصال
          </a>
          <a href={`https://wa.me/${waPhone(lead.phone)}`} target="_blank" rel="noopener noreferrer"
            className="m-press flex flex-1 items-center justify-center"
            style={{ boxSizing: "border-box", height: 46, borderRadius: 12, background: MOBILE_COLORS.sheet, border: `1px solid ${MOBILE_COLORS.border}`, color: MOBILE_COLORS.textPrimary, fontSize: 14, fontWeight: 600, gap: 6 }}>
            💬 واتساب
          </a>
        </div>
      </div>

      {/* ===== التبويبان ===== */}
      <div className="grid grid-cols-2" style={{ gap: 8 }}>
        <button type="button" onClick={() => setTab("fu")} className="m-press" style={{ ...chip(tab === "fu"), minHeight: 44, textAlign: "center" }}>
          المتابعة والزيارات ({toArabicDigits(lead.followUpsCount)})
        </button>
        <button type="button" onClick={() => setTab("data")} className="m-press" style={{ ...chip(tab === "data"), minHeight: 44, textAlign: "center" }}>
          بيانات
        </button>
      </div>

      {tab === "data" ? (
        <DataTab lead={lead} projects={projects} />
      ) : (
        <FuTab
          lead={lead}
          timeline={timeline}
          nowMs={nowMs}
          onNew={() => setFuOpen({ key: null })}
          onEdit={(f) => setEditFu(f)}
        />
      )}

      {/* ===== الشريط السفلي الثابت: تم الحجز + شراء فوري + رخصة فال ===== */}
      <div className="m-actionbar mx-auto w-full max-w-lg" style={{ padding: "0 18px" }}>
        <div
          style={{
            boxSizing: "border-box", borderRadius: 16, padding: "10px 12px",
            background: `linear-gradient(180deg, transparent, ${MOBILE_COLORS.bg} 26%)`,
          }}
        >
          <div className="flex" style={{ gap: 8 }}>
            <button type="button" onClick={() => setFuOpen({ key: "booked" })}
              className="m-press flex flex-1 items-center justify-center"
              style={{ boxSizing: "border-box", height: 46, borderRadius: 12, border: "none", background: MOBILE_COLORS.amber, color: MOBILE_COLORS.bg, fontSize: 13.5, fontWeight: 700 }}>
              ✅ تم الحجز
            </button>
            <button type="button" onClick={() => setFuOpen({ key: "booked" })}
              className="m-press flex flex-1 items-center justify-center"
              style={{ boxSizing: "border-box", height: 46, borderRadius: 12, border: "none", background: MOBILE_COLORS.mint, color: MOBILE_COLORS.bg, fontSize: 13.5, fontWeight: 700 }}>
              ⚡ شراء فوري
            </button>
          </div>
          {falLicense && (
            <div className="text-center" style={{ fontSize: 10, color: MOBILE_COLORS.textMuted, marginTop: 6 }}>
              رخصة فال (REGA) <span dir="ltr">{falLicense}</span>
            </div>
          )}
        </div>
      </div>

      {/* الأوراق */}
      {fuOpen && (
        <FollowupSheet
          open
          onClose={() => setFuOpen(null)}
          leadId={lead.id}
          leadName={lead.name}
          phone={lead.phone}
          stage={lead.stage}
          firstContact={lead.firstContact}
          projects={projects}
          initialKey={fuOpen.key}
        />
      )}
      {editFu && (
        <EditFollowupSheet
          open
          onClose={() => setEditFu(null)}
          leadId={lead.id}
          followupId={editFu.id}
          initialNote={editFu.note}
          initialDate={editFu.nextDate}
          createdAt={editFu.createdAt}
        />
      )}
    </div>
  );
}

/* ===================== تبويب «بيانات» — updateLeadDetails القائم ===================== */

function DataTab({ lead, projects }: { lead: ProfileData; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [goal, setGoal] = useState<PurchaseGoal | null>(lead.purchaseGoal);
  const [method, setMethod] = useState<PurchaseMethod | null>(lead.purchaseMethod);
  const [priceMin, setPriceMin] = useState(lead.priceMin?.toString() ?? "");
  const [priceMax, setPriceMax] = useState(lead.priceMax?.toString() ?? "");
  const [sourceSel, setSourceSel] = useState(lead.sourceId ?? "");
  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [areas, setAreas] = useState<string[]>(lead.preferredAreas);
  const [projSel, setProjSel] = useState<Set<string>>(new Set(lead.preferredProjects));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // جلب المصادر عند أول عرض للتبويب (نفس أكشن نموذج الإضافة) — بخطأ ظاهر لا صامت.
  useEffect(() => {
    fetchSources().then(setSources).catch(() => setMsg({ ok: false, text: "تعذّر تحميل قائمة المصادر — حدّث الصفحة" }));
  }, []);

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateLeadIntake(lead.id, {
        purchaseGoal: goal,
        purchaseMethod: method,
        priceMin: priceMin ? Number(priceMin.replace(/[^\d]/g, "")) : null,
        priceMax: priceMax ? Number(priceMax.replace(/[^\d]/g, "")) : null,
        sourceId: sourceSel || null,
        preferredAreas: areas,
        preferredProjects: [...projSel],
      });
      setMsg(res.ok ? { ok: true, text: "تم حفظ البيانات ✓" } : { ok: false, text: res.error ?? "صار خطأ" });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div style={{ ...box, padding: 14 }} className="flex flex-col gap-3">
        {/* الهوية للعرض — تعديل الاسم/الجوال للمدير فقط (قاعدة الخادم القائمة) */}
        <Row label="الاسم"><input value={lead.name} disabled style={{ ...fieldStyle, opacity: 0.6 }} /></Row>
        <Row label="الجوال"><input value={lead.phone} disabled dir="ltr" style={{ ...fieldStyle, opacity: 0.6 }} /></Row>

        <Row label="هدف الشراء">
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {(Object.keys(purchaseGoalLabels) as PurchaseGoal[]).map((g) => (
              <button key={g} type="button" onClick={() => setGoal(goal === g ? null : g)} className="m-press" style={chip(goal === g)}>
                {purchaseGoalLabels[g]}
              </button>
            ))}
          </div>
        </Row>
        <Row label="طريقة الشراء">
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {purchaseMethodOptions.map((m) => (
              <button key={m} type="button" onClick={() => setMethod(method === m ? null : m)} className="m-press" style={chip(method === m)}>
                {purchaseMethodLabels[m]}
              </button>
            ))}
          </div>
        </Row>
        <div className="grid grid-cols-2" style={{ gap: 9 }}>
          <Row label="السعر من"><input value={priceMin} onChange={(e) => setPriceMin(e.target.value)} inputMode="numeric" dir="ltr" style={fieldStyle} placeholder="500000" /></Row>
          <Row label="السعر إلى"><input value={priceMax} onChange={(e) => setPriceMax(e.target.value)} inputMode="numeric" dir="ltr" style={fieldStyle} placeholder="900000" /></Row>
        </div>
        <Row label="المصدر">
          <select value={sourceSel} onChange={(e) => setSourceSel(e.target.value)} style={fieldStyle}>
            <option value="">— اختر المصدر —</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Row>
        <DistrictSelect value={areas} onChange={setAreas} disabled={pending} />
        <Row label="المشاريع المناسبة">
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {projects.length === 0 ? (
              <span style={{ fontSize: 12, color: MOBILE_COLORS.textMuted }}>ما فيه مشاريع</span>
            ) : projects.map((p) => (
              <button key={p.id} type="button" className="m-press"
                onClick={() => setProjSel((s) => { const n = new Set(s); if (n.has(p.name)) n.delete(p.name); else n.add(p.name); return n; })}
                style={chip(projSel.has(p.name))}>
                {projSel.has(p.name) ? "✓ " : ""}{p.name}
              </button>
            ))}
          </div>
        </Row>

        {msg && (
          <p style={{
            boxSizing: "border-box", borderRadius: 10, padding: "9px 12px", fontSize: "12.5px", textAlign: "center",
            background: msg.ok ? MOBILE_COLORS.mintBg : MOBILE_COLORS.roseBg,
            color: msg.ok ? MOBILE_COLORS.mint : MOBILE_COLORS.rose,
          }}>{msg.text}</p>
        )}
        <button type="button" onClick={save} disabled={pending}
          className="m-press m-sweep w-full"
          style={{ boxSizing: "border-box", height: 48, borderRadius: 13, border: "none", background: MOBILE_COLORS.amber, color: MOBILE_COLORS.bg, fontSize: 14, fontWeight: 700, opacity: pending ? 0.6 : 1 }}>
          {pending ? "جارٍ الحفظ…" : "💾 حفظ البيانات"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block" style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}

/* ===================== تبويب «المتابعة والزيارات» ===================== */

function FuTab({
  lead, timeline, nowMs, onNew, onEdit,
}: {
  lead: ProfileData;
  timeline: ({ kind: "fu"; at: Date; f: ProfileFu } | { kind: "act"; at: Date; a: ProfileAct })[];
  nowMs: number;
  onNew: () => void;
  onEdit: (f: ProfileFu) => void;
}) {
  const upcoming = lead.visitAt && lead.visitAt.getTime() > nowMs
    ? { at: lead.visitAt, label: "زيارة" }
    : lead.nextFollowup && lead.nextFollowup.getTime() > nowMs
      ? { at: lead.nextFollowup, label: "متابعة" }
      : null;
  // ✎ الموعد القادم = تعديل آخر متابعة — يظهر فقط داخل نافذة الساعة (والخادم هو الحكم).
  const latest = lead.followUps[0] ?? null;
  const latestEditable = latest && editMinutesLeft(latest.createdAt, nowMs) > 0;

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      {lead.firstContact ? (
        <FirstContactCard lead={lead} />
      ) : (
        <>
          <button type="button" onClick={onNew}
            className="m-press m-sweep flex w-full items-center justify-center"
            style={{ boxSizing: "border-box", height: 50, borderRadius: 14, border: "none", background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 15, fontWeight: 700, gap: 6 }}>
            + متابعة جديدة
          </button>
          {upcoming && (
            <div className="flex items-center justify-between" style={{ boxSizing: "border-box", borderRadius: 13, padding: "10px 13px", background: MOBILE_COLORS.amberBg, border: `1px solid ${MOBILE_COLORS.amber}`, gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: MOBILE_COLORS.amber }}>
                🗓️ الموعد القادم: {upcoming.label} — {fmtDT(upcoming.at)}
              </span>
              {latestEditable && latest && (
                <button type="button" onClick={() => onEdit(latest)} className="m-press flex-none"
                  style={{ boxSizing: "border-box", borderRadius: 9, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, border: `1px solid ${MOBILE_COLORS.amber}`, background: "transparent", color: MOBILE_COLORS.amber }}>
                  ✎
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* سجل المتابعات / الخط الزمني */}
      <section className="flex flex-col" style={{ gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: MOBILE_COLORS.textPrimary, padding: "0 2px" }}>
          سجل المتابعات ({toArabicDigits(lead.followUpsCount)})
        </h2>
        {timeline.length === 0 ? (
          <div className="flex flex-col items-center" style={{ ...box, gap: 6, padding: "24px 14px" }}>
            <span style={{ fontSize: 20 }} aria-hidden>📭</span>
            <span style={{ fontSize: 12.5, color: MOBILE_COLORS.textSecondary }}>ما فيه أحداث بعد — سجّل أول تواصل فوق</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {timeline.map((item, i) => (
              <div key={item.kind === "fu" ? `f-${item.f.id}` : `a-${item.a.id}`} className="flex" style={{ gap: 12 }}>
                <div className="flex flex-none flex-col items-center" style={{ width: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 6, marginTop: 4, background: item.kind === "fu" ? fuTone(item.f.result) : STAGE_HEX[lead.stage] }} />
                  {i < timeline.length - 1 && <span style={{ flex: 1, width: "1.5px", background: MOBILE_COLORS.border }} />}
                </div>
                {item.kind === "fu" ? (
                  <div style={{ flex: 1, paddingBottom: 18 }}>
                    <div className="flex items-center justify-between" style={{ gap: 8 }}>
                      <span style={{ fontSize: "13.5px", fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>
                        {followUpResultLabels[item.f.result]}
                      </span>
                      {editMinutesLeft(item.f.createdAt, nowMs) > 0 && (
                        <button type="button" onClick={() => onEdit(item.f)} className="m-press flex-none"
                          style={{ boxSizing: "border-box", borderRadius: 8, padding: "3px 9px", fontSize: 10.5, fontWeight: 700, background: MOBILE_COLORS.goldBg, color: MOBILE_COLORS.gold, border: `1px solid ${MOBILE_COLORS.goldBorder}` }}>
                          ✎ {toArabicDigits(editMinutesLeft(item.f.createdAt, nowMs))} د
                        </button>
                      )}
                    </div>
                    {item.f.note && <div style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginTop: 5, lineHeight: 1.7 }}>{item.f.note}</div>}
                    {item.f.nextDate && item.f.nextDate.getTime() > nowMs && (
                      <span className="inline-block" style={{ boxSizing: "border-box", marginTop: 7, borderRadius: 8, padding: "4px 9px", fontSize: "11.5px", fontWeight: 600, background: MOBILE_COLORS.skyBg, color: MOBILE_COLORS.sky }}>
                        🗓️ الموعد القادم: {fmtDT(item.f.nextDate)}
                      </span>
                    )}
                    <div style={{ fontSize: "10.5px", color: MOBILE_COLORS.textMuted, marginTop: 6 }}>
                      {fmtDT(item.f.createdAt)} · {item.f.userName ?? "النظام"}
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, paddingBottom: 18 }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                      {/* خصوصية الموظف: أحداث الإسناد بنص عام موحّد — بلا تفاصيل التوزيع/السحب */}
                      {item.a.type === "ASSIGNMENT" ? "انتقل إليك العميل" : activityTypeLabels[item.a.type]}
                    </div>
                    {item.a.type !== "ASSIGNMENT" && item.a.note && (
                      <div style={{ boxSizing: "border-box", fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginTop: 6, lineHeight: 1.65, background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 12, padding: "9px 11px" }}>
                        {item.a.note}
                      </div>
                    )}
                    <div style={{ fontSize: "10.5px", color: MOBILE_COLORS.textMuted, marginTop: 6 }}>
                      {fmtDT(item.a.createdAt)}{item.a.type !== "ASSIGNMENT" && item.a.userName ? ` · ${item.a.userName}` : ""}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ===================== بطاقة «سجّل أول تواصل» — إلزامية بشبكة ٢×٢ ===================== */

function FirstContactCard({ lead }: { lead: ProfileData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<"interested" | "noanswer" | "calllater" | "notInterested" | null>(null);
  const [step, setStep] = useState<"visit" | "call" | "none" | null>(null);
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [retry, setRetry] = useState<"yes" | "no">("no");
  const [note, setNote] = useState("");
  const [dateOnly, setDateOnly] = useState("");
  const [timeOnly, setTimeOnly] = useState("");
  const [error, setError] = useState<string | null>(null);
  const date = dateOnly ? `${dateOnly}T${timeOnly || "10:00"}` : "";

  // الإلزام حسب المواصفة المعتمدة: زيارة/اتصال/«طلب وقت آخر» = موعد إلزامي؛
  // غير مهتم = سبب إلزامي (+موعد مع «نحاول لاحقًا») — أشد من الخادم، لا يكسره.
  const needDate = (sel === "interested" && (step === "visit" || step === "call")) || sel === "calllater" || (sel === "notInterested" && retry === "yes");
  const needReason = sel === "notInterested" && reasons.size === 0;
  const needStep = sel === "interested" && step === null;
  const missing = needStep ? "اختر الخطوة الجاية" : needDate && !dateOnly ? "⚠️ الموعد إلزامي — اختر التاريخ" : needReason ? "اختر سبب عدم الاهتمام" : null;

  const options: { key: typeof sel & string; label: string; base: string; bg: string }[] = [
    { key: "interested", label: "😍 مهتم", base: MOBILE_COLORS.mint, bg: MOBILE_COLORS.mintBg },
    { key: "noanswer", label: "📵 لا يرد", base: MOBILE_COLORS.sky, bg: MOBILE_COLORS.skyBg },
    { key: "calllater", label: "🕐 طلب وقت آخر", base: MOBILE_COLORS.amber, bg: MOBILE_COLORS.amberBg },
    { key: "notInterested", label: "🚫 غير مهتم", base: MOBILE_COLORS.rose, bg: MOBILE_COLORS.roseBg },
  ];

  function submit() {
    if (!sel || missing) return;
    let body: SaveBody | null = null;
    if (sel === "notInterested") {
      body = buildNotInterestedBody(reasons, retry, date, note) as SaveBody;
    } else if (sel === "interested" && (step === "visit" || step === "call")) {
      // مهتم بموعد — نفس مسارَي شجرة المتابعة القائمة (زيارة/اتصال).
      body = buildBody({ key: "interested", stage: lead.stage, step, visitAction: null, noShowChoice: null, note, date });
    } else {
      body = buildFirstContactBody(sel === "interested" ? "interested" : sel, note, date);
    }
    if (!body) { setError("اختر نتيجة"); return; }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/leads/${lead.id}/followups`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data?.error ?? "صار خطأ"); return; }
        router.refresh();
      } catch {
        setError("ما وصلنا للخادم — تحقق من الإنترنت وحاول مرة ثانية");
      }
    });
  }

  const saveLabel = sel === "notInterested"
    ? retry === "yes" ? "حفظ — نحاول لاحقًا" : "حفظ — غير مهتم نهائي"
    : "حفظ النتيجة";

  return (
    <div className="relative overflow-hidden" style={{ ...box, padding: 14 }}>
      <span aria-hidden style={{ position: "absolute", insetInlineStart: 0, top: 12, bottom: 12, width: 4, borderRadius: 3, background: MOBILE_COLORS.sky, boxShadow: `0 0 12px ${MOBILE_COLORS.sky}` }} />
      <div style={{ fontSize: 15, fontWeight: 800, color: MOBILE_COLORS.textPrimary }}>📋 سجّل أول تواصل مع العميل</div>
      <div style={{ fontSize: 12, color: MOBILE_COLORS.textSecondary, marginTop: 4 }}>اختر نتيجة أول تواصل <b>(إلزامي)</b></div>

      <div className="grid grid-cols-2" style={{ gap: 8, marginTop: 12 }}>
        {options.map((o) => (
          <button key={o.key} type="button"
            onClick={() => { setSel(o.key); setStep(null); setReasons(new Set()); setRetry("no"); setDateOnly(""); setTimeOnly(""); setError(null); }}
            className="m-press"
            style={{
              boxSizing: "border-box", minHeight: 52, borderRadius: 12, fontSize: 13.5, fontWeight: 700,
              ...(sel === o.key ? { background: o.bg, color: o.base, border: `1px solid ${o.base}` } : { background: MOBILE_COLORS.bg, color: MOBILE_COLORS.textSecondary, border: `1px solid ${MOBILE_COLORS.border}` }),
            }}>
            {o.label}
          </button>
        ))}
      </div>

      {sel === "interested" && (
        <div style={{ marginTop: 11 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MOBILE_COLORS.gold, marginBottom: 8 }}>وش الخطوة الجاية؟</div>
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            <button type="button" onClick={() => setStep("visit")} className="m-press" style={chip(step === "visit")}>🏠 يبغى زيارة</button>
            <button type="button" onClick={() => setStep("call")} className="m-press" style={chip(step === "call")}>📞 موعد اتصال</button>
            <button type="button" onClick={() => { setStep("none"); setDateOnly(""); setTimeOnly(""); }} className="m-press" style={chip(step === "none")}>مهتم بدون موعد</button>
          </div>
        </div>
      )}

      {sel === "calllater" && (
        <div style={{ fontSize: 12, fontWeight: 600, color: MOBILE_COLORS.amber, marginTop: 11 }}>متى قال أرجع له؟ <b>(إلزامي)</b></div>
      )}

      {sel === "notInterested" && (
        <div style={{ marginTop: 11 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MOBILE_COLORS.rose, marginBottom: 8 }}>السبب (إلزامي)</div>
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {NI_REASONS.map((r: string) => (
              <button key={r} type="button" className="m-press"
                onClick={() => setReasons((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; })}
                style={chip(reasons.has(r), MOBILE_COLORS.rose, MOBILE_COLORS.roseBg, MOBILE_COLORS.rose)}>
                {r}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: MOBILE_COLORS.textSecondary, margin: "10px 0 7px" }}>نحاول معه مرة ثانية لاحقًا؟</div>
          <div className="flex" style={{ gap: 7 }}>
            <button type="button" onClick={() => setRetry("yes")} className="m-press" style={chip(retry === "yes")}>نعم — نحاول لاحقًا</button>
            <button type="button" onClick={() => setRetry("no")} className="m-press" style={chip(retry === "no")}>لا — نهائي</button>
          </div>
        </div>
      )}

      {(needDate || (sel === "interested" && (step === "visit" || step === "call"))) && (
        <div style={{ marginTop: 11 }}>
          <div className="flex" style={{ gap: 8 }}>
            <label className="flex flex-col justify-center" style={{ boxSizing: "border-box", flex: 1, minHeight: 52, gap: 3, background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 12, padding: "7px 12px" }}>
              <span style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>📅 التاريخ</span>
              <input type="date" value={dateOnly} onChange={(e) => setDateOnly(e.target.value)} style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: MOBILE_COLORS.textPrimary }} />
            </label>
            <label className="flex flex-col justify-center" style={{ boxSizing: "border-box", flex: 1, minHeight: 52, gap: 3, background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 12, padding: "7px 12px" }}>
              <span style={{ fontSize: "11.5px", color: MOBILE_COLORS.textSecondary }}>🕐 الوقت</span>
              <input type="time" value={timeOnly} onChange={(e) => setTimeOnly(e.target.value)} style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, color: MOBILE_COLORS.textPrimary }} />
            </label>
          </div>
        </div>
      )}

      {sel && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="ملاحظة اختيارية…"
          style={{ boxSizing: "border-box", width: "100%", marginTop: 11, background: MOBILE_COLORS.bg, border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 12, padding: "10px 12px", minHeight: 60, fontSize: 13, color: MOBILE_COLORS.textPrimary, resize: "vertical", outline: "none" }} />
      )}

      {error && (
        <p style={{ boxSizing: "border-box", marginTop: 10, borderRadius: 10, padding: "9px 12px", fontSize: "12.5px", textAlign: "center", background: MOBILE_COLORS.roseBg, color: MOBILE_COLORS.rose }}>{error}</p>
      )}

      {sel && (
        <>
          <button type="button" onClick={submit} disabled={pending || !!missing}
            className="m-press m-sweep w-full"
            style={{ boxSizing: "border-box", marginTop: 11, height: 50, borderRadius: 13, border: "none", background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg, fontSize: 14.5, fontWeight: 700, opacity: pending || missing ? 0.55 : 1 }}>
            {pending ? "جارٍ الحفظ…" : saveLabel}
          </button>
          {missing && <div className="text-center" style={{ fontSize: 11.5, color: MOBILE_COLORS.textMuted, marginTop: 7 }}>{missing}</div>}
        </>
      )}

      <div style={{ fontSize: 12, color: MOBILE_COLORS.textMuted, marginTop: 13 }}>
        سجل المتابعات (٠) — يبدأ بأول نتيجة تسجّلها.
      </div>
    </div>
  );
}

export default LeadProfileV3;
