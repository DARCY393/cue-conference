import type { Metadata } from "next";
import { Jost, Public_Sans } from "next/font/google";
import "./globals.css";
import SiteChrome from "@/components/SiteChrome";

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "500"],
  variable: "--font-jost",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cue — Conference Room Booking",
  description: "Request-to-book conference room in Dallas",
  icons: {
    icon: "/branding/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jost.variable} ${publicSans.variable}`}>
      <body className="min-h-screen bg-cue-paper text-cue-stone-700 antialiased">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
