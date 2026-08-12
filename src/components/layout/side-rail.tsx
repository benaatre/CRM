"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users2, Contact, KanbanSquare, Building2, Handshake,
  BarChart3, ScrollText, MessagesSquare, Share2, Copy, PhoneMissed, Settings,
} from "lucide-react";
import { toArabicDigits } from "@/lib/format";

/**
 * الشريط الجانبي الزجاجي — ٧٠px مطويًا، يتمدد لـ٢٣٨px **بالمرور** (لا بزر).
 *
 * التمدد **فوق المحتوى لا يدفعه**: خانة الشريط في الـflex تبقى ٧٠px ثابتة،
 * والطبقة الزجاجية داخلها `absolute` بعرض متغيّر وz-index أعلى — فلا تتزحزح
 * الصفحة عند المرور. الأب `sticky h-dvh` (وهو عنصر مموضع) فيصلح مرساةً لها.
 *
 * الأيقونات تُختار بمفتاح نصّي لأن مكوّنات lucide لا تُسلسَل من الخادم للعميل.
 * العنصر الفعّال (الصفحة الحالية) **وحده** ذهبي — قاعدة دليل ٢٠٢٦.
 */

const ICONS = {
  dashboard: LayoutDashboard, leads: Contact, duplicates: Copy, noResponse: PhoneMissed,
  pipeline: KanbanSquare, projects: Building2, bookings: Handshake, chat: MessagesSquare,
  analytics: BarChart3, team: Users2, distribution: Share2, audit: ScrollText, settings: Settings,
} as const;

export type RailItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge: number;
};

const RAIL_W = 70;
const OPEN_W = 238;

export function SideRail({ items, falLicense, brandName }: {
  items: RailItem[];
  falLicense: string | null;
  brandName: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 z-40 hidden h-dvh w-[70px] shrink-0 lg:block" aria-label="التنقّل الرئيسي">
      <div
        className="group absolute inset-y-0 end-0 flex flex-col overflow-hidden backdrop-blur-2xl motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-out"
        style={{ width: RAIL_W, background: "var(--glass)" }}
        onMouseEnter={(e) => { e.currentTarget.style.width = `${OPEN_W}px`; }}
        onMouseLeave={(e) => { e.currentTarget.style.width = `${RAIL_W}px`; }}
      >
        {/* الهوية — الحرف الأول مطويًا، والاسم الكامل عند التمدد */}
        <div className="flex h-[68px] flex-none items-center gap-3 px-[22px]">
          <span className="grid size-[26px] flex-none place-items-center rounded-lg bg-gold/15 text-[13px] font-bold text-gold">
            {brandName.trim().charAt(0)}
          </span>
          <span className="whitespace-nowrap text-[14.5px] font-semibold text-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {brandName}
          </span>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {items.map((it) => {
            const Icon = ICONS[it.icon];
            const active = it.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === it.href || pathname.startsWith(`${it.href}/`);
            return (
              <Link
                key={it.href}
                href={it.href}
                title={it.badge > 0 ? `${it.label} (${toArabicDigits(it.badge)})` : it.label}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-11 flex-none items-center gap-3.5 rounded-xl px-[11px] transition-colors ${
                  active ? "bg-gold/10 text-gold" : "text-muted-foreground hover:bg-white/[.04] hover:text-foreground"
                }`}
              >
                <span className="relative grid size-[22px] flex-none place-items-center">
                  <Icon className="size-[19px]" strokeWidth={1.6} aria-hidden />
                  {/* الشارة مطويًا: نقطة حمراء فقط — الرقم يظهر عند التمدد */}
                  {it.badge > 0 && (
                    <span
                      aria-hidden
                      className="absolute -top-0.5 end-[-2px] size-[7px] rounded-full bg-destructive transition-opacity duration-200 group-hover:opacity-0"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[13.5px] font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  {it.label}
                </span>
                {it.badge > 0 && (
                  <span
                    className="flex-none rounded-md bg-destructive/15 px-2 py-0.5 text-[11.5px] font-semibold text-destructive opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {toArabicDigits(it.badge)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* رخصة فال — تبقى ظاهرة: الرقم مطويًا، وبعنوانه عند التمدد */}
        {falLicense && (
          <div className="flex-none px-3 pb-4 pt-2 text-center">
            <div className="h-0 overflow-hidden text-[11.5px] text-muted-foreground/70 transition-all duration-200 group-hover:h-4">
              ترخيص فال (REGA)
            </div>
            <div
              className="truncate text-[11.5px] font-medium text-gold"
              dir="ltr"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {falLicense}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export default SideRail;
