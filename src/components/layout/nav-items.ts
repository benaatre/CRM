import {
  LayoutDashboard,
  Contact,
  KanbanSquare,
  Building2,
  Handshake,
  BarChart3,
  Users2,
  ScrollText,
  MessagesSquare,
  Share2,
  Copy,
  PhoneMissed,
  Settings as SettingsIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  managerOnly: boolean;
  ownerOnly?: boolean;
};

// عناصر التنقّل — مشتركة بين الشريط الجانبي (سطح المكتب) ودرج الجوال.
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, managerOnly: false },
  { href: "/leads", label: "كل العملاء", icon: Contact, managerOnly: false },
  { href: "/leads/duplicates", label: "العملاء المكررون", icon: Copy, managerOnly: true, ownerOnly: true },
  { href: "/no-response", label: "لم يتم الرد", icon: PhoneMissed, managerOnly: true, ownerOnly: true },
  { href: "/pipeline", label: "مراحل العملاء", icon: KanbanSquare, managerOnly: false },
  { href: "/projects", label: "المشاريع", icon: Building2, managerOnly: false },
  { href: "/bookings", label: "خط المبيعات", icon: Handshake, managerOnly: false },
  { href: "/chat", label: "الشات الداخلي", icon: MessagesSquare, managerOnly: false },
  { href: "/analytics", label: "التحليلات", icon: BarChart3, managerOnly: false },
  { href: "/admin", label: "الفريق", icon: Users2, managerOnly: true },
  { href: "/distribution", label: "التوزيع التلقائي", icon: Share2, managerOnly: true },
  { href: "/audit", label: "سجل التدقيق", icon: ScrollText, managerOnly: true },
  { href: "/settings", label: "الإعدادات", icon: SettingsIcon, managerOnly: true },
];

export const navForRole = (isManager: boolean, isOwner = false): NavItem[] =>
  NAV_ITEMS.filter((n) => (!n.managerOnly || isManager) && (!n.ownerOnly || isOwner));
