import Link from "next/link";
import { BellOff, ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth-guards";
import { getNotifications } from "@/lib/actions/notifications";
import { MOBILE_COLORS, MOBILE_STATUS } from "@/lib/mobile-tokens";
import { toArabicDigits } from "@/lib/mobile-format";
import { MarkAllReadButton } from "@/components/mobile/mark-all-read";

export const dynamic = "force-dynamic";

/**
 * الإشعارات — من نفس دالة الويب `getNotifications()` (محجَّمة: إشعارات
 * المستخدم نفسه فقط، آخر ٣٠). لا منطق جديد.
 */
export default async function MobileNotificationsPage() {
  await requireUser();
  const { items, unread } = await getNotifications();

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <div className="flex items-center justify-between" style={{ gap: 10 }}>
        <Link
          href="/m"
          className="flex items-center"
          style={{ minHeight: 44, gap: 5, color: MOBILE_COLORS.textSecondary, fontSize: 13 }}
        >
          <ChevronLeft size={18} style={{ transform: "scaleX(-1)" }} aria-hidden />
          رجوع
        </Link>
        {unread > 0 && <MarkAllReadButton />}
      </div>

      <div className="flex items-baseline" style={{ gap: 9, padding: "0 2px" }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: MOBILE_COLORS.textPrimary }}>الإشعارات</h1>
        {unread > 0 && (
          <span
            style={{
              boxSizing: "border-box", fontSize: 13, fontWeight: 600,
              color: MOBILE_STATUS.danger.fg, background: MOBILE_STATUS.danger.bg,
              padding: "3px 9px", borderRadius: 8,
            }}
          >
            {toArabicDigits(unread)} جديد
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div
          className="flex flex-col items-center text-center"
          style={{
            boxSizing: "border-box", gap: 9, padding: "34px 16px",
            background: MOBILE_COLORS.card, borderRadius: 16,
            border: `1px solid ${MOBILE_COLORS.border}`,
          }}
        >
          <BellOff size={34} style={{ color: MOBILE_COLORS.textMuted }} aria-hidden />
          <p style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary }}>ما فيه إشعارات</p>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 9 }}>
          {items.map((n) => {
            // روابط الإشعارات تشير لمسارات الويب — نحوّل ما له مقابل في /m.
            const href = toMobileLink(n.link);
            const body = (
              <>
                <div className="flex items-start justify-between" style={{ gap: 8 }}>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: MOBILE_COLORS.textPrimary }}>
                    {n.title}
                  </div>
                  {!n.read && (
                    <span
                      className="flex-none"
                      style={{ width: 8, height: 8, borderRadius: 4, background: MOBILE_STATUS.danger.base, marginTop: 5 }}
                      aria-label="غير مقروء"
                    />
                  )}
                </div>
                {n.body && (
                  <div style={{ fontSize: "12.5px", color: MOBILE_COLORS.textSecondary, marginTop: 5, lineHeight: 1.6 }}>
                    {n.body}
                  </div>
                )}
                <div style={{ fontSize: 11, color: MOBILE_COLORS.textMuted, marginTop: 6 }}>
                  {fmtDateTime(n.createdAt)}
                </div>
              </>
            );
            const style = {
              boxSizing: "border-box" as const,
              background: MOBILE_COLORS.card,
              border: `1px solid ${n.read ? MOBILE_COLORS.border : MOBILE_COLORS.goldBorder}`,
              borderRadius: 14,
              padding: "12px 13px",
              minHeight: 44,
            };
            return href ? (
              <Link key={n.id} href={href} className="block" style={style}>
                {body}
              </Link>
            ) : (
              <div key={n.id} style={style}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** يحوّل رابط إشعار الويب لمقابله في الجوال، وإلا يُسقطه (لا نخرج من التطبيق). */
function toMobileLink(link: string | null): string | null {
  if (!link) return null;
  const lead = link.match(/^\/leads\/([^/?#]+)/);
  if (lead) return `/m/leads/${lead[1]}`;
  if (link.startsWith("/leads")) return "/m/leads";
  if (link.startsWith("/dashboard")) return "/m";
  return null;
}

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
    timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short",
  }).format(d);
}
