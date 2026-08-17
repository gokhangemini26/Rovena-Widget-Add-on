import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rovena — AI Stylist Add-on",
  description: "Embeddable AI stylist for fashion brands.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
