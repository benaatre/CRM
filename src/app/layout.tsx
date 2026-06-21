import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Reem_Kufi } from "next/font/google";
import "./globals.css";

// خط الواجهة والنصوص العربية
const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-ibm-plex-arabic",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// خط الشعار «مشاريع السلطان»
const reemKufi = Reem_Kufi({
  variable: "--font-reem-kufi",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "مشاريع السلطان — نظام إدارة المبيعات",
  description:
    "نظام CRM عقاري لشركة مشاريع السلطان — إدارة العملاء والمشاريع والحجوزات والتحليلات.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${ibmPlexArabic.variable} ${reemKufi.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
