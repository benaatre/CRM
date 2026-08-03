import Link from "next/link";
import {
  CalendarCheck, Archive, Bell, KeyRound, Share2, Copy, ScrollText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requireUser, isManager } from "@/lib/auth-guards";
import { getLeads } from "@/lib/data/leads";
import { getSettings } from "@/lib/data/settings";
import { roleLabel } from "@/lib/labels";
import { buildAgenda } from "@/lib/mobile-agenda";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";

export const dynamic = "force-dynamic";

const APP_VERSION = "١٫٠٫٠";

type Tile = { href: string; label: string; sub: string; icon: LucideIcon; badge?: number; external?: boolean };

export default async function MobileMorePage() {
  const user = await requireUser();
  const manager = isManager(user.role);

  // استعلاما قراءة فقط — كلاهما محجَّم/موجود، بلا منطق جديد.
  const [leads, settings] = await Promise.all([
    getLeads({ tab: "working", sort: "activity" }),
    getSettings(),
  ]);
  const { dueToday } = buildAgenda(leads);

  const firstName = (user.name ?? "").trim().split(/\s+/)[0] || "زميلي";

  // بطاقات الموظف. الحجوزات/المؤرشفون/الإشعارات/تغيير الرمز.
  const tiles: Tile[] = [
    { href: "/bookings", label: "الحجوزات", sub: "خط المبيعات", icon: CalendarCheck, external: true },
    { href: "/m/leads?stage=CLOSED_LOST", label: "المؤرشفون", sub: "المنسحبون والمغلقون", icon: Archive },
    { href: "/m/more", label: "الإشعارات", sub: "قريبًا", icon: Bell },
    { href: "/reset-pin", label: "تغيير الرمز", sub: "رمز الدخول", icon: KeyRound, external: true },
  ];

  // أدوات المالك/المدير — روابط للويب مؤقتًا حتى تُبنى شاشاتها في الجوال.
  const managerTiles: Tile[] = [
    { href: "/distribution", label: "التوزيع التلقائي", sub: "الويب", icon: Share2, external: true },
    { href: "/leads/duplicates", label: "المكرّرون", sub: "الويب", icon: Copy, external: true },
    { href: "/audit", label: "سجل التدقيق", sub: "الويب", icon: ScrollText, external: true },
  ];

  const all = manager ? [...tiles, ...managerTiles] : tiles;

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* ===== الترويسة ===== */}
      <div className="flex items-start justify-between" style={{ padding: "0 2px" }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>المزيد</h1>
          <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.gold, marginTop: 4 }}>حسابي والأدوات</div>
        </div>
        <div
          className="flex items-center justify-center"
          style={{
            boxSizing: "border-box", width: 44, height: 44, borderRadius: 14,
            background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
            fontSize: 14, fontWeight: 700,
          }}
          aria-hidden
        >
          {firstName.slice(0, 1)}
        </div>
      </div>

      {/* ===== بطاقة الحساب + إحصاءان ===== */}
      <div
        style={{
          boxSizing: "border-box", background: MOBILE_COLORS.card,
          border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 20,
          padding: "15px 15px 15px 17px",
        }}
      >
        <div className="flex items-center" style={{ gap: 12 }}>
          <div
            className="flex flex-none items-center justify-center"
            style={{
              boxSizing: "border-box", width: 52, height: 52, borderRadius: 16,
              background: MOBILE_COLORS.gold, color: MOBILE_COLORS.bg,
              fontSize: 16, fontWeight: 700,
            }}
            aria-hidden
          >
            {firstName.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="truncate" style={{ fontSize: 17, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
              {user.name ?? "مستخدم"}
            </div>
            <div style={{ fontSize: 12, color: MOBILE_COLORS.gold, marginTop: 4 }}>
              {roleLabel(user.role)}
            </div>
          </div>
        </div>

        <div className="flex" style={{ gap: 11, marginTop: 14 }}>
          <Stat value={leads.length} label="عملائي" />
          <Stat value={dueToday.length} label="متابعات اليوم" />
        </div>
      </div>

      {/* ===== شبكة الأدوات ===== */}
      <div className="grid grid-cols-2" style={{ gap: 11 }}>
        {all.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.label}
              href={t.href}
              {...(t.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="flex flex-col justify-between text-right"
              style={{
                boxSizing: "border-box", position: "relative",
                background: MOBILE_COLORS.card, border: `1px solid ${MOBILE_COLORS.border}`,
                borderRadius: 20, padding: "14px 15px 15px", minHeight: 124, overflow: "hidden",
              }}
            >
              <div className="flex w-full items-start justify-between">
                {t.badge ? (
                  <span
                    className="flex items-center justify-center"
                    style={{
                      boxSizing: "border-box", minWidth: 22, height: 22, borderRadius: 11,
                      background: MOBILE_STATUS.danger.base, color: "#FFFFFF",
                      fontSize: "10.5px", fontWeight: 700, padding: "0 6px",
                    }}
                  >
                    {toArabicDigits(t.badge)}
                  </span>
                ) : (
                  <span />
                )}
                <span
                  className="flex items-center justify-center"
                  style={{
                    boxSizing: "border-box", width: 38, height: 38, borderRadius: 12,
                    background: MOBILE_COLORS.goldBg,
                  }}
                >
                  <Icon size={19} style={{ color: MOBILE_COLORS.gold }} aria-hidden />
                </span>
              </div>
              <div>
                <div style={{ fontSize: "14.5px", fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>
                  {t.label}
                </div>
                <div style={{ fontSize: "11.5px", color: MOBILE_COLORS.gold, marginTop: 5 }}>{t.sub}</div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* ===== الخروج ===== */}
      <a
        href="/api/logout"
        className="flex items-center justify-center"
        style={{
          boxSizing: "border-box", minHeight: 52, borderRadius: 16,
          border: `1px solid ${MOBILE_STATUS.danger.border}`,
          background: MOBILE_STATUS.danger.bg, color: MOBILE_STATUS.danger.base,
          fontSize: "14.5px", fontWeight: 700,
        }}
      >
        تسجيل الخروج
      </a>

      {/* ===== الترخيص والإصدار ===== */}
      <div
        className="text-center"
        style={{ fontSize: 11, color: MOBILE_COLORS.dim1, lineHeight: 1.9, padding: "6px 0 4px" }}
      >
        ترخيص فال (REGA) {toArabicDigits(settings.falLicense ?? "1200021029")}
        <br />
        الإصدار {APP_VERSION}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center"
      style={{
        boxSizing: "border-box", background: MOBILE_COLORS.bg,
        border: `1px solid ${MOBILE_COLORS.border}`, borderRadius: 14,
        padding: "10px 8px", gap: 3,
      }}
    >
      <span style={{ fontSize: 19, fontWeight: 700, color: MOBILE_COLORS.gold, lineHeight: 1 }}>
        {toArabicDigits(value)}
      </span>
      <span style={{ fontSize: 11, color: MOBILE_COLORS.textMuted }}>{label}</span>
    </div>
  );
}
