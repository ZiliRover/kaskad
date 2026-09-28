import type { Metadata } from "next";
import { JetBrains_Mono, Onest } from "next/font/google";
import { BRAND } from "@/config/brand";
import { THEME_BOOT_SCRIPT } from "@/config/theme";
import "./globals.css";

const sans = Onest({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${sans.variable} ${mono.variable}`} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* theme must be set before paint; it lives in localStorage, so the server can't know it */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
