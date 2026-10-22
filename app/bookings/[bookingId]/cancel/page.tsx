import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CalendarX2 } from "lucide-react";
import { getBookingById } from "@/lib/bookings";
import { requestedPagePath, verifyBookingAccessToken } from "@/lib/booking-access";
import { cancellationOutcomeText, previewCancellation } from "@/lib/cancellation";
import { formatMoney } from "@/lib/format";
import { getSpaceById } from "@/lib/space-service";
import { CONTACT_NAME, CONTACT_PHONE_DISPLAY, CONTACT_PHONE_TEL, CONTACT_SUITE } from "@/lib/hold-copy";
import type { Booking } from "@/lib/types";
import { CancelConfirm } from "./CancelConfirm";

// Per-guest page: never cache, never index, never leak the token via Referer.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cancel booking — Cue",
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

const STATUS_LABEL: Record<string, string> = {
  requested: "Request pending (card hold, not charged)",
  accepted: "Confirmed (charged)",
  cancelled: "Cancelled",
  declined: "Declined",
  expired: "Expired",
  in_progress: "In progress",
  completed: "Completed",
};

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
            <CalendarX2 aria-hidden className="h-8 w-8 shrink-0 text-cue-copper-300" />
            {title}
          </h1>
          {intro && <p className="mt-3 max-w-[60ch] text-base text-white/85">{intro}</p>}
        </div>
      </FullBleed>
      <FullBleed className="-mb-10 bg-white">
        <div className="mx-auto max-w-[920px] space-y-8 px-4 py-10 sm:px-6 sm:py-14">
          {children}
          <p className="text-sm text-cue-stone-700" data-testid="cancel-contact">
            Questions? {CONTACT_NAME} — <a href={`tel:${CONTACT_PHONE_TEL}`}>{CONTACT_PHONE_DISPLAY}</a>, or stop by{" "}
            {CONTACT_SUITE}.
          </p>
        </div>
      </FullBleed>
    </>
  );
}

export default async function CancelPage({
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

  // Wrong/missing token and unknown booking look identical: no booking details either way.
  if (!valid || !booking || booking.status === "draft") {
    return (
      <Shell eyebrow="Cancel booking" title="This link isn't valid">
        <div className="rounded-tile bg-cue-navy-050 p-4 text-sm text-cue-stone-700" data-testid="cancel-invalid">
          <p className="font-semibold text-cue-navy-600">We couldn&apos;t find a booking for this cancellation link.</p>
          <p className="mt-1">
            Please use the &ldquo;Cancel booking&rdquo; link from your most recent Cue email, or contact us and we&apos;ll
            help.
          </p>
        </div>
      </Shell>
    );
  }

  const space = await getSpaceById(booking.spaceId).catch(() => null);
  const preview = previewCancellation(booking, { rules: space?.cancellationPolicy?.rules });
  const roomName = booking.spaceShortTitle || booking.spaceTitle || "Conference room";
  const when = whenLines(booking);
  const isAccepted = booking.status === "accepted";

  const summary = (
    <section className="cue-card p-5 sm:p-6" data-testid="cancel-summary">
      <h2 className="text-xl">Your booking</h2>
      <dl className="mt-3 divide-y divide-cue-stone-200 border-y border-cue-stone-200">
        <SummaryRow label="Room" value={booking.spaceTitle || roomName} />
        <SummaryRow label="Date" value={when.date} />
        <SummaryRow label="Time" value={when.time} />
        <SummaryRow label="Status" value={<span data-testid="cancel-status">{STATUS_LABEL[booking.status] ?? booking.status}</span>} />
        <SummaryRow
          label={booking.status === "requested" ? "Hold amount (not charged)" : "Total"}
          value={formatMoney(booking.totalCents)}
          strong
        />
        {booking.status === "cancelled" && (
          <SummaryRow
            label="Refund"
            value={
              booking.cancellationAction === "release_hold"
                ? "Hold released — not charged"
                : booking.refundCents
                  ? `${formatMoney(booking.refundCents)} refunded`
                  : "No refund"
            }
          />
        )}
      </dl>
    </section>
  );

  if (booking.status === "cancelled") {
    const outcome = booking.cancellationAction
      ? cancellationOutcomeText(booking.cancellationAction, booking.refundCents ?? 0)
          .replace("will be released", "has been released")
          .replace("Full refund of", "A full refund of")
          .replace(" to your card.", " is on its way back to your card (usually 5–10 business days).")
      : "Any hold on your card has been released.";
    return (
      <Shell eyebrow={`Cancel booking · ${roomName}`} title="Booking cancelled" intro="This booking has been cancelled and the room is free for others.">
        <div className="rounded-tile border border-cue-copper-300 bg-cue-copper-050 p-4 text-sm text-cue-stone-700" data-testid="cancel-cancelled">
          <p className="font-semibold text-cue-navy-600">You&apos;re all set</p>
          <p className="mt-1" data-testid="cancel-outcome">{outcome}</p>
        </div>
        {summary}
      </Shell>
    );
  }

  if (!preview.cancellable) {
    const body =
      preview.blockedReason === "started"
        ? "This booking has already started or passed, so it can't be cancelled online. Please contact us if something went wrong."
        : booking.status === "declined" || booking.status === "expired"
          ? "This request isn't active any more, so there's nothing to cancel. The hold on your card was released and you were not charged."
          : "This booking can't be cancelled online. Please contact us.";
    return (
      <Shell eyebrow={`Cancel booking · ${roomName}`} title="Nothing to cancel">
        <div className="rounded-tile bg-cue-navy-050 p-4 text-sm text-cue-stone-700" data-testid="cancel-not-cancellable">
          <p className="font-semibold text-cue-navy-600">{STATUS_LABEL[booking.status] ?? "Not cancellable"}</p>
          <p className="mt-1">{body}</p>
        </div>
        {summary}
      </Shell>
    );
  }

  return (
    <Shell
      eyebrow={`Cancel booking · ${roomName}`}
      title="Cancel your booking?"
      intro={
        isAccepted
          ? "Free cancellation up to 48 hours before your booking starts. No refund after that."
          : "Your request hasn't been accepted yet, so cancelling simply releases the hold on your card."
      }
    >
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {summary}
        <section className="space-y-4" data-testid="cancel-outcome-panel">
          <h2 className="text-xl">What happens if you cancel</h2>
          <div className="rounded-tile border border-cue-copper-300 bg-cue-copper-050 p-4" data-testid="cancel-outcome">
            <p className="font-display text-2xl text-cue-navy-600">
              {preview.action === "release_hold"
                ? "Hold released"
                : preview.action === "refund"
                  ? `Full refund ${formatMoney(preview.refundCents)}`
                  : "No refund"}
            </p>
            <p className="mt-1 text-sm text-cue-stone-700">{preview.summary}</p>
          </div>
          <CancelConfirm
            bookingId={booking.id}
            token={token!}
            outcomeLabel={preview.summary}
            keepHref={requestedPagePath(booking.id)}
          />
        </section>
      </div>
    </Shell>
  );
}
