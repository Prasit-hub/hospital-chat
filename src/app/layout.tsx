import type { Metadata } from "next";
import "./globals.css";
import { themeBootScript } from "@/lib/theme-boot";

export const metadata: Metadata = {
  title: "รวมแชท — ศูนย์ประสานงานคนไข้",
  description: "ศูนย์รวมแชทคนไข้จาก LINE, Facebook, Instagram และอีเมล — หนึ่งแฟ้มต่อหนึ่งคน",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Anuphan:wght@300;400;500;600;700&family=Bai+Jamjuree:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
