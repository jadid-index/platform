import type { Metadata, Viewport } from "next";
import { Onest, Unbounded } from "next/font/google";

import { AppShell } from "@/components/shell/app-shell";
import { locale, t } from "@/i18n";
import { THEME_BOOT_SCRIPT } from "@/lib/themes";

import "./globals.css";

// Onest: one sans family, 400 body to 800 headings. Checked glyph by glyph: Uzbek Latin (oʻ gʻ with U+02BB, ʼ U+02BC),
// Russian Cyrillic and Uzbek Cyrillic (Ўў Ққ Ғғ Ҳҳ, in cyrillic-ext). Manrope lacks U+02BB, so it was not used.
const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
});

// Unbounded: tier badge codes only (font-tier), so tiers stand apart from the text until they get their own icons.
// Has Latin and Cyrillic, because admins can rename tier codes on /admin/rubric.
const unbounded = Unbounded({
  variable: "--font-unbounded",
  weight: ["800"],
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
});

export const metadata: Metadata = {
  title: t.common.appName,
  description: t.home.tagline,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// The theme is applied by a tiny script before the first paint (from the jadid-theme cookie), not by reading the
// cookie on the server: that would make every page dynamic and drop the prerendered shell. Without the script or
// with an unknown value the default theme (:root) shows. suppressHydrationWarning: the script sets data-theme.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={locale} className={`${onest.variable} ${unbounded.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
