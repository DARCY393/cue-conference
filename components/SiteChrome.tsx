"use client";

import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, MapPin, Phone } from "lucide-react";

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 h-[74px] border-b border-cue-stone-200 bg-[rgba(250,248,245,0.92)] backdrop-blur-[10px]">
      <div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="https://thecue.work" className="flex items-center" aria-label="Cue — thecue.work">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/logo-cue-navy.png" alt="Cue" className="h-7 w-auto" />
        </a>
        <nav className="flex items-center gap-6 text-sm font-medium text-cue-stone-700">
          <Link href="/spaces/arts-district-m1" className="no-underline hover:text-cue-navy-600">
            Book a room
          </Link>
          <Link href="/host" className="no-underline hover:text-cue-navy-600">
            Host
          </Link>
          <a
            href="https://thecue.work"
            className="hidden no-underline text-cue-stone-500 hover:text-cue-navy-600 sm:inline"
          >
            thecue.work
          </a>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-cue-navy-800 text-white/80">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/logo-cue-light.png" alt="Cue" className="h-6 w-auto" />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/70">
            Dallas coworking &amp; conference rooms.
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2">
            <MapPin aria-hidden className="h-4 w-4 shrink-0" />
            750 N. St. Paul Street, Dallas, TX 75201
          </p>
          <p className="flex items-center gap-2">
            <Phone aria-hidden className="h-4 w-4 shrink-0" />
            <a href="tel:+12143934833" className="no-underline text-white/80 hover:text-white">
              (214) 393-4833
            </a>
          </p>
          <p className="flex items-center gap-2">
            <Mail aria-hidden className="h-4 w-4 shrink-0" />
            <a href="mailto:hello@thecue.work" className="no-underline text-white/80 hover:text-white">
              hello@thecue.work
            </a>
          </p>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto max-w-5xl px-4 py-4 text-xs text-white/50 sm:px-6">
          Cue — thecue.work
        </div>
      </div>
    </footer>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const embed = params.get("embed") === "1";
  if (embed) {
    return <main className="px-3 py-4">{children}</main>;
  }
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
      <SiteFooter />
    </>
  );
}

/** Hides the site header/footer and uses a compact layout when ?embed=1 (for the thecue.work iframe). */
export default function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <>
          <SiteHeader />
          <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
          <SiteFooter />
        </>
      }
    >
      <Chrome>{children}</Chrome>
    </Suspense>
  );
}
