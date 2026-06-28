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
  Settings as SettingsIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  managerOnly: boolean;
};

// عناصر التنقّل — مشتركة بين الشريط الجانبي (سطح المكتب) ودرج الجوال.
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, managerOnly: false },
  { href: "/leads", label: "كل العملاء", icon: Contact, managerOnly: false },
  { href: "/pipeline", label: "مراحل العملاء", icon: KanbanSquare, managerOnly: false },
  { href: "/projects", label: "المشاريع", icon: Building2, managerOnly: false },
  { href: "/bookings", label: "خط المبيعات", icon: Handshake, managerOnly: false },
  { href: "/chat", label: "الشات الداخلي", icon: MessagesSquare, managerOnly: false },
  { href: "/analytics", label: "التحليلات", icon: BarChart3, managerOnly: false },
  { href: "/admin", label: "الفريق", icon: Users2, managerOnly: true },
  { href: "/audit", label: "سجل التدقيق", icon: ScrollText, managerOnly: true },
  { href: "/settings", label: "الإعدادات", icon: SettingsIcon, managerOnly: true },
];

export const navForRole = (isManager: boolean): NavItem[] =>
  NAV_ITEMS.filter((n) => !n.managerOnly || isManager);
