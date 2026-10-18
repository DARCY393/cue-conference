import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cue — Conference Room Booking",
  description: "Request-to-book conference room in Dallas",
  icons: {
    icon: "/branding/favicon-192.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased text-cue-ink">
        <header className="border-b border-white/10 bg-cue-navy text-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
            <a
              href="https://thecue.work"
              className="inline-flex items-center gap-3 text-white hover:text-white/90"
              aria-label="Cue — thecue.work"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/branding/cue-logo.png"
                alt="Cue"
                className="h-8 w-auto"
              />
            </a>
            <nav className="flex items-center gap-5 text-sm font-light text-white/90">
              <Link href="/spaces/arts-district-m1" className="text-white/90 hover:text-white">
                Book space
              </Link>
              <Link href="/host" className="text-white/90 hover:text-white">
                Host
              </Link>
              <a
                href="https://thecue.work"
                className="hidden text-white/70 hover:text-white sm:inline"
              >
                thecue.work
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
        <footer className="border-t border-cue-navy/10 bg-white">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-8 text-center text-sm text-cue-muted sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="font-display text-base text-cue-navy">Cue</p>
              <p className="mt-1 font-light">Dallas coworking &amp; conference rooms</p>
            </div>
            <div className="space-y-1 font-light">
              <p>
                <a href="mailto:hello@thecue.work" className="hover:text-cue-navy">
                  hello@thecue.work
                </a>
              </p>
              <p>
                <a href="tel:+12143934833" className="hover:text-cue-navy">
                  (214) 393-4833
                </a>
              </p>
              <p>Dallas, TX</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
