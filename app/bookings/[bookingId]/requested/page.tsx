import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { ContactForm } from "@/components/ContactForm";
import { getBookingById } from "@/lib/bookings";
import { cancelPagePath, verifyBookingAccessToken } from "@/lib/booking-access";
import { formatMoney } from "@/lib/format";
import {
  CONTACT_NAME,
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_TEL,
  CONTACT_SUITE,
  FREE_CANCELLATION_TEXT,
  HOLD_HEADING,
  WHAT_HAPPENS_NEXT,
} from "@/lib/hold-copy";
import type { Booking } from "@/lib/types";

// Per-guest page: never cache, never index, never leak the token via Referer.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Request received — Cue",
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

function fmtDate(iso: string, withWeekday = true): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: withWeekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function whenLines(b: Booking): { date: string; time: string } {
  const sameDay = chicagoDay(b.startsAt) === chicagoDay(b.endsAt);
  return {
    date: sameDay ? fmtDate(b.startsAt) : `${fmtDate(b.startsAt)} – ${fmtDate(b.endsAt)}`,
    time: `${fmtTime(b.startsAt)} – ${fmtTime(b.endsAt)} CT${sameDay ? "" : " each day"}`,
  };
}

function hoursFor(b: Booking): number {
  if (b.quoteJson?.hours) return b.quoteJson.hours;
  return Math.round(((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 3_600_000) * 100) / 100;
}

function SummaryRow({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-cue-stone-500">{label}</dt>
      <dd className={`text-right text-sm ${strong ? "font-semibold text-cue-copper-600" : "text-cue-ink"}`}>{value}</dd>
    </div>
  );
}

const STATUS_NOTE: Partial<Record<Booking["status"], { title: string; body: string }>> = {
  accepted: {
    title: "Good news — your booking is confirmed",
    body: "We've accepted your request and charged the hold. Check your email for arrival instructions.",
  },
  declined: {
    title: "This request was declined",
    body: "The hold on your card has been released. You were not charged.",
  },
  expired: {
    title: "This request expired",
    body: "We didn't respond within 24 hours, so the hold on your card was released. You were not charged.",
  },
  cancelled: {
    title: "This request was cancelled",
    body: "Any hold on your card has been released.",
  },
};

export default async function RequestedPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { bookingId } = await params;
  const { t } = await searchParams;
  const token = Array.isArray(t) ? t[0] : t;
  // Booking id + HMAC token; a wrong or missing token looks exactly like a missing booking.
  if (!verifyBookingAccessToken(bookingId, token)) notFound();
  const booking = await getBookingById(bookingId).catch(() => null);
  if (!booking || booking.status === "draft") notFound();

  const roomName = booking.spaceShortTitle || booking.spaceTitle || "Conference room";
  const when = whenLines(booking);
  const hours = hoursFor(booking);
  const passes = booking.parkingPasses ?? 0;
  const discountLine = booking.quoteJson?.lineItems?.find((l) => l.code === "discount_long_booking");
  const firstName = (booking.guestName || "").trim().split(/\s+/)[0];
  const note = STATUS_NOTE[booking.status];
  const isPending = booking.status === "requested";
  const canCancel =
    (booking.status === "requested" || booking.status === "accepted") && Date.parse(booking.startsAt) > Date.now();

  return (
    <>
      <FullBleed className="-mt-10 bg-cue-navy-700">
        <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-6 sm:py-10">
          <p className="cue-eyebrow text-cue-copper-300">Booking request · {roomName}</p>
          <h1 className="mt-2 flex items-center gap-3 text-[clamp(26px,4vw,36px)] text-white">
            <CheckCircle2 aria-hidden className="h-8 w-8 shrink-0 text-cue-copper-300" />
            Request received
          </h1>
          <p className="mt-3 max-w-[60ch] text-base text-white/85">
            {firstName ? `Thanks, ${firstName}. ` : "Thanks. "}
            {HOLD_HEADING} — we&apos;ve placed a temporary hold of{" "}
            <strong className="font-semibold text-white">{formatMoney(booking.totalCents)}</strong> while we review
            your request.
          </p>
        </div>
      </FullBleed>

      <FullBleed className="bg-white">
        <div className="mx-auto max-w-[920px] space-y-10 px-4 py-10 sm:px-6 sm:py-14">
          {note && !isPending && (
            <div role="status" className="rounded-tile bg-cue-navy-050 p-4 text-sm text-cue-stone-700">
              <p className="font-semibold text-cue-navy-600">{note.title}</p>
              <p className="mt-1">{note.body}</p>
            </div>
          )}

          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section aria-labelledby="summary-heading" className="cue-card p-5 sm:p-6" data-testid="requested-summary">
              <h2 id="summary-heading" className="text-xl">
                Your request
              </h2>
              <dl className="mt-3 divide-y divide-cue-stone-200 border-y border-cue-stone-200">
                <SummaryRow label="Room" value={booking.spaceTitle || roomName} />
                <SummaryRow label="Date" value={when.date} />
                <SummaryRow label="Time" value={when.time} />
                <SummaryRow label="Hours" value={`${hours} hr${hours === 1 ? "" : "s"}`} />
                <SummaryRow
                  label="Parking"
                  value={passes > 0 ? `${passes} pass${passes === 1 ? "" : "es"} · ${formatMoney(booking.parkingCents ?? 0)}` : "None"}
                />
                {booking.discountCents > 0 && (
                  <>
                    <SummaryRow label="Room charge" value={formatMoney(booking.subtotalCents)} />
                    <SummaryRow
                      label={discountLine?.label || "Long booking discount"}
                      value={<span className="text-cue-green-600">−{formatMoney(booking.discountCents)}</span>}
                    />
                  </>
                )}
                <SummaryRow label="Hold amount (not charged)" value={formatMoney(booking.totalCents)} strong />
                <SummaryRow label="Name" value={booking.guestName || "—"} />
                <SummaryRow label="Email" value={<span className="break-all">{booking.guestEmail || "—"}</span>} />
              </dl>
              <p className="mt-4 flex items-start gap-2 text-sm text-cue-stone-700" data-testid="emailed-copy">
                <Mail aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-cue-copper-600" />
                <span>
                  We&apos;ve emailed a copy of this request to{" "}
                  <strong className="break-all font-medium text-cue-navy-600">{booking.guestEmail || "you"}</strong>.
                </span>
              </p>
            </section>

            <section aria-labelledby="next-heading" data-testid="what-happens-next">
              <h2 id="next-heading" className="text-xl">
                What happens next
              </h2>
              <ol className="mt-4 space-y-5">
                {WHAT_HAPPENS_NEXT.map((step, i) => (
                  <li key={step.title} className="flex gap-4">
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cue-copper-600 font-display text-sm text-white"
                    >
                      {i + 1}
                    </span>
                    <div className="pt-1">
                      <p className="text-sm font-semibold text-cue-navy-600">{step.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-cue-stone-700">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-6 flex items-start gap-2 rounded-tile border border-cue-copper-300 bg-cue-copper-050 p-4 text-sm text-cue-stone-700">
                <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-cue-copper-600" />
                <span>
                  Depending on your bank, a released hold can take a few days to disappear from your statement.{" "}
                  {FREE_CANCELLATION_TEXT}
                </span>
              </p>
              {canCancel && (
                <p className="mt-4 text-sm text-cue-stone-700">
                  Plans changed?{" "}
                  <a
                    href={cancelPagePath(booking.id)}
                    className="font-semibold text-cue-copper-600 underline underline-offset-2 hover:text-cue-copper-700"
                    data-testid="requested-cancel-link"
                  >
                    Cancel booking
                  </a>
                </p>
              )}
            </section>
          </div>
        </div>
      </FullBleed>

      <FullBleed className="-mb-10 bg-cue-paper">
        <div className="mx-auto max-w-[920px] space-y-4 px-4 py-12 sm:px-6 sm:py-14" data-testid="questions">
          <h2 className="text-2xl">Questions?</h2>
          <p className="text-sm text-cue-stone-700">
            {CONTACT_NAME} — <a href={`tel:${CONTACT_PHONE_TEL}`}>{CONTACT_PHONE_DISPLAY}</a>, or stop by {CONTACT_SUITE}.
            You can also send us a message:
          </p>
          <ContactForm roomName={booking.spaceTitle} roomSlug={booking.spaceSlug} />
        </div>
      </FullBleed>
    </>
  );
}
