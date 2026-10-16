import type { Metadata } from "next";
import { Alexandria, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n/client";
import { dirOf } from "@/i18n/core";
import { dictFor, getLocale } from "@/i18n/server";
import "./globals.css";

const alexandria = Alexandria({ variable: "--font-alexandria", subsets: ["latin", "latin-ext"] });
// Arabic letters are drawn in Cairo (bold and very clear on phones); Latin letters and digits stay
// Alexandria. The file is Google Fonts' Arabic part of Cairo (SIL Open Font License, fonts/OFL-Cairo.txt),
// so it only ever applies to Arabic text, in both languages (wilaya names are Arabic everywhere).
const cairo = localFont({
  src: "./fonts/cairo-arabic.woff2",
  variable: "--font-cairo",
  weight: "200 1000",
  display: "swap",
  // No Arial stand-in: Latin text must fall through to Alexandria, not to a fallback face.
  adjustFontFallback: false,
  declarations: [
    { prop: "unicode-range", value: "U+0600-06FF, U+0750-077F, U+0870-0891, U+0897-08E1, U+08E3-08FF, U+200C-200D, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC" },
    // Cairo's letters are a little small next to Alexandria's: a touch larger reads better on a phone.
    { prop: "size-adjust", value: "108%" },
  ],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "COD Flow Tracker", template: "%s · COD Flow Tracker" },
  description: "Delivered-profit analytics for Cash on Delivery e-commerce.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)} className={`${cairo.variable} ${alexandria.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <I18nProvider locale={locale} dict={dictFor(locale)}>
          {/* Every page, sign-in included, has ⓘ explanations (HelpTip). */}
          <TooltipProvider>{children}</TooltipProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
