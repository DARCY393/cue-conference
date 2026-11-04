import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CarFront } from "lucide-react";
import { getBookingById } from "@/lib/bookings";
import { verifyBookingAccessToken } from "@/lib/booking-access";
import { getParkingRecipients, parkingEditable } from "@/lib/parking-recipients";
import { PARKING_ENTRANCE_TEXT } from "@/lib/arrival-instructions";
import { PARKING_NO_MARKETING_TEXT, PARKING_QR_TEXT } from "@/lib/email-templates";
import { getSpaceById } from "@/lib/space-service";
import { CONTACT_NAME, CONTACT_PHONE_DISPLAY, CONTACT_PHONE_TEL, CONTACT_SUITE } from "@/lib/hold-copy";
import type { Booking } from "@/lib/types";
import { ParkingForm } from "./ParkingForm";

// Per-guest page: never cache, never index, never leak the token via Referer.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Parking passes — Cue",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const TZ = "America/Chicago";

function FullBleed({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative left-1/2 w-screen -translate-x-1/2 ${className}`}>{children}</div>;
}

function chicagoDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso)
  );
}
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso)
  );
}
function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
function whenLines(b: Booking) {
  const sameDay = chicagoDay(b.startsAt) === chicagoDay(b.endsAt);
  return {
    date: sameDay ? fmtDate(b.startsAt) : `${fmtDate(b.startsAt)} – ${fmtDate(b.endsAt)}`,
    time: `${fmtTime(b.startsAt)} – ${fmtTime(b.endsAt)} CT${sameDay ? "" : " each day"}`,
  };
}

function SummaryRow({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-cue-stone-500">{label}</dt>
      <dd className={`text-right text-sm ${strong ? "font-semibold text-cue-copper-600" : "text-cue-ink"}`}>{value}</dd>
    </div>
  );
}

function Shell({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <>
      <FullBleed className="-mt-10 bg-cue-navy-700">
        <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-6 sm:py-10">
          <p className="cue-eyebrow text-cue-copper-300">{eyebrow}</p>
          <h1 className="mt-2 flex items-center gap-3 text-[clamp(26px,4vw,36px)] text-white">
            <CarFront aria-hidden className="h-8 w-8 shrink-0 text-cue-copper-300" />
            {title}
          </h1>
          {intro && <p className="mt-3 max-w-[60ch] text-base text-white/85">{intro}</p>}
        </div>
      </FullBleed>
      <FullBleed className="-mb-10 bg-white">
        <div className="mx-auto max-w-[920px] space-y-8 px-4 py-10 sm:px-6 sm:py-14">
          {children}
          <p className="text-sm text-cue-stone-700" data-testid="parking-contact">
            Questions? {CONTACT_NAME} — <a href={`tel:${CONTACT_PHONE_TEL}`}>{CONTACT_PHONE_DISPLAY}</a>, or stop by{" "}
            {CONTACT_SUITE}.
          </p>
        </div>
      </FullBleed>
    </>
  );
}

export default async function ParkingPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { bookingId } = await params;
  const { t } = await searchParams;
  const token = Array.isArray(t) ? t[0] : t;
  const valid = verifyBookingAccessToken(bookingId, token);
  const booking = valid ? await getBookingById(bookingId).catch(() => null) : null;

  if (!valid || !booking || booking.status === "draft" || !(booking.parkingPasses ?? 0)) {
    return (
      <Shell eyebrow="Parking passes" title="This link isn't valid">
        <div className="rounded-tile bg-cue-navy-050 p-4 text-sm text-cue-stone-700" data-testid="parking-invalid">
          <p className="font-semibold text-cue-navy-600">We couldn&apos;t find a booking with parking for this link.</p>
          <p className="mt-1">Please use the link from your most recent Cue email, or contact us and we&apos;ll help.</p>
        </div>
      </Shell>
    );
  }

  const space = await getSpaceById(booking.spaceId).catch(() => null);
  const roomName = space?.shortTitle || booking.spaceShortTitle || booking.spaceTitle || "Conference room";
  const when = whenLines(booking);
  const passes = booking.parkingPasses ?? 0;
  const recipients = await getParkingRecipients(booking.id);
  const editable = parkingEditable(booking);

  const summary = (
    <section className="cue-card p-5 sm:p-6" data-testid="parking-summary">
      <h2 className="text-xl">Your booking</h2>
      <dl className="mt-3 divide-y divide-cue-stone-200 border-y border-cue-stone-200">
        <SummaryRow label="Room" value={booking.spaceTitle || roomName} />
        <SummaryRow label="Date" value={when.date} />
        <SummaryRow label="Time" value={when.time} />
        <SummaryRow label="Parking passes" value={String(passes)} strong />
      </dl>
      <h3 className="mt-6 text-lg">Good to know</h3>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-cue-stone-700" data-testid="parking-notes">
        <li>{PARKING_QR_TEXT}</li>
        <li>{PARKING_ENTRANCE_TEXT}</li>
        <li>{PARKING_NO_MARKETING_TEXT}</li>
      </ul>
    </section>
  );

  if (!editable) {
    return (
      <Shell eyebrow={`Parking passes · ${roomName}`} title="Parking pass holders">
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {summary}
          <section className="space-y-3" data-testid="parking-readonly">
            <div className="rounded-tile bg-cue-navy-050 p-4 text-sm text-cue-stone-700">
              {booking.status === "accepted"
                ? "Your booking has started, so this list can't be changed online. Please contact us if something's wrong."
                : "This booking isn't active, so there's no parking list to fill in."}
            </div>
            {recipients.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-cue-stone-700">
                {recipients.map((r, i) => (
                  <li key={i}>Pass {i + 1}: {r.phone || r.email}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      eyebrow={`Parking passes · ${roomName}`}
      title="Who's getting a parking pass?"
      intro={`Your booking includes ${passes} parking pass${passes === 1 ? "" : "es"}. Add a mobile number or email for each person and we'll send them a QR code for the gate.`}
    >
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {summary}
        <section className="space-y-4">
          <h2 className="text-xl">Pass holders</h2>
          <ParkingForm bookingId={booking.id} token={token!} passes={passes} initial={recipients} />
        </section>
      </div>
    </Shell>
  );
}
