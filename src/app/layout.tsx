import type { Metadata } from "next";
import { Alexandria, Geist_Mono } from "next/font/google";
import "./globals.css";

const alexandria = Alexandria({ variable: "--font-alexandria", subsets: ["latin", "latin-ext", "arabic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "COD Flow Tracker", template: "%s · COD Flow Tracker" },
  description: "Delivered-profit analytics for Cash on Delivery e-commerce.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${alexandria.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
