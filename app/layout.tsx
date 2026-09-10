import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cue — Conference Room Booking",
  description: "Request-to-book conference room in Dallas",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight text-slate-900">
              Cue
            </Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              <Link href="/spaces/cue-dallas" className="hover:text-blue-600">
                Book space
              </Link>
              <Link href="/host" className="hover:text-blue-600">
                Host
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-slate-400">
          Cue MVP — Request to book · America/Chicago
        </footer>
      </body>
    </html>
  );
}
