import type { Metadata } from "next";
import { Alexandria, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/i18n/client";
import { dirOf } from "@/i18n/core";
import { dictFor, getLocale } from "@/i18n/server";
import "./globals.css";

const alexandria = Alexandria({ variable: "--font-alexandria", subsets: ["latin", "latin-ext", "arabic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "COD Flow Tracker", template: "%s · COD Flow Tracker" },
  description: "Delivered-profit analytics for Cash on Delivery e-commerce.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)} className={`${alexandria.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <I18nProvider locale={locale} dict={dictFor(locale)}>{children}</I18nProvider>
      </body>
    </html>
  );
}
