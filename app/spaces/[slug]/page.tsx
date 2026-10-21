"use client";

import { FormEvent, MouseEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useParams, useRouter } from "next/navigation";
import { Clock, CreditCard, MapPin, Users } from "lucide-react";
import type { Quote, SpacePublic } from "@/lib/types";
import HouseRules from "@/components/HouseRules";
import { ContactForm } from "@/components/ContactForm";
import { HoldNotice } from "@/components/HoldNotice";
import {
  RESERVE_ANCHOR,
  RequestToBookButton,
  scrollToReserve,
} from "@/components/RequestToBookButton";
import { holdButtonLabel } from "@/lib/hold-copy";
import { AmenityTile } from "@/components/ui/AmenityTile";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { capacityLabel, formatMoney, formatRate, roomCode } from "@/lib/format";
import { isValidEmail } from "@/lib/validate";
import { MAX_GALLERY_PHOTOS } from "@/lib/space-public";

const PARKING_MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=720+N+Ervay+St+Dallas+TX+75201";

const money = formatMoney;

/** Breaks a section out of the centered page container to span the full viewport width. */
function FullBleed({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative left-1/2 w-screen -translate-x-1/2 ${className}`}>{children}</div>;
}

/** Next weekday (Mon–Fri) on or after today, read in America/Chicago, as a yyyy-mm-dd date-input value. */
function nextWeekdayChicago(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  let date = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
  let weekday = get("weekday");
  while (weekday === "Sat" || weekday === "Sun") {
    date = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(date);
  }
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** One idempotency key per checkout attempt, so a double click or retry can't create two bookings. */
function newRequestKey(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function RoomPlaceholder({ code, capacity }: { code: string; capacity: string }) {
  return (
    <div className="flex h-72 w-full flex-col items-center justify-center gap-1 bg-cue-stone-100 sm:h-96">
      <span className="font-display text-5xl text-cue-navy-600">{code}</span>
      <span className="text-sm text-cue-stone-500">{capacity}</span>
    </div>
  );
}

/**
 * Main photo + clickable thumbnails. Landscape shots fill the frame; portrait shots are shown
 * whole (object-contain) over a blurred copy of themselves so they are never awkwardly cropped.
 * Falls back to the room-code placeholder if every photo fails to load or none exist.
 */
function RoomGallery({ space }: { space: SpacePublic }) {
  const photos = useMemo(() => space.photos.slice(0, MAX_GALLERY_PHOTOS), [space.photos]);
  const [active, setActive] = useState(0);
  const [errored, setErrored] = useState<Record<number, boolean>>({});
  const [portrait, setPortrait] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setActive(0);
    setErrored({});
  }, [space.id]);

  const allErrored = photos.length === 0 || photos.every((_, i) => errored[i]);
  if (allErrored) {
    return <RoomPlaceholder code={roomCode(space)} capacity={capacityLabel(space)} />;
  }

  const activeIndex = errored[active] ? photos.findIndex((_, i) => !errored[i]) : active;
  const activePhoto = photos[activeIndex];
  const isPortrait = activePhoto ? portrait[activePhoto.url] : false;

  return (
    <div>
      {activePhoto && !errored[activeIndex] ? (
        <div
          className="relative h-72 w-full overflow-hidden bg-cue-navy-600 sm:h-[28rem]"
          data-testid="gallery-main"
        >
          {isPortrait && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activePhoto.url}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={activePhoto.url}
            src={activePhoto.url}
            alt={activePhoto.alt || space.title}
            data-orientation={isPortrait ? "portrait" : "landscape"}
            className={`relative h-full w-full ${isPortrait ? "object-contain" : "object-cover object-center"}`}
            onLoad={(e) => {
              const img = e.currentTarget;
              const tall = img.naturalHeight > img.naturalWidth;
              setPortrait((m) => (m[activePhoto.url] === tall ? m : { ...m, [activePhoto.url]: tall }));
            }}
            onError={() => setErrored((e) => ({ ...e, [activeIndex]: true }))}
          />
          {photos.length > 1 && (
            <span className="absolute bottom-3 right-3 rounded-full bg-cue-navy-600/80 px-2.5 py-1 text-xs font-medium text-white">
              {activeIndex + 1} / {photos.length}
            </span>
          )}
        </div>
      ) : (
        <RoomPlaceholder code={roomCode(space)} capacity={capacityLabel(space)} />
      )}
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-t border-cue-stone-200 bg-cue-stone-100 p-2">
          {photos.map((p, i) =>
            errored[i] ? null : (
              <button
                key={`${p.url}-${i}`}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show photo ${i + 1}${p.alt ? `: ${p.alt}` : ""}`}
                aria-current={i === activeIndex}
                className={`h-14 w-20 shrink-0 overflow-hidden rounded-tile border-2 sm:h-16 sm:w-24 ${
                  i === activeIndex ? "border-cue-copper-600" : "border-transparent"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover object-center"
                  onError={() => setErrored((e) => ({ ...e, [i]: true }))}
                />
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
/** Stripe Connect (direct charges): the platform pk plus the connected account, so Elements confirms on that account. */
const connectedAccountId = (process.env.NEXT_PUBLIC_STRIPE_CONNECTED_ACCOUNT_ID ?? "").trim();
const stripePromise = publishableKey
  ? loadStripe(publishableKey, connectedAccountId ? { stripeAccount: connectedAccountId } : undefined)
  : null;
/** Test or mock mode is the only supported mode today — live keys are refused server-side. */
const isTestOrMockStripe = !publishableKey || publishableKey.startsWith("pk_test_");

function isMockSecret(secret: string) {
  return secret.includes("_secret_mock");
}

function normalizeTime(value: string): string {
  const v = value.trim();
  // Already HH:MM or HH:MM:SS
  const m24 = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(v);
  if (m24) return `${m24[1].padStart(2, "0")}:${m24[2]}`;
  // 12h like 9:00 AM / 12:00 PM
  const m12 = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i.exec(v);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2];
    const ap = m12[3].toUpperCase();
    if (ap === "AM") {
      if (h === 12) h = 0;
    } else if (h !== 12) {
      h += 12;
    }
    return `${String(h).padStart(2, "0")}:${min}`;
  }
  return v;
}

/** Half-hour slots 07:00–18:00 (Cue bookable window). */
const TIME_OPTIONS: string[] = Array.from({ length: 23 }, (_, i) => {
  const minutes = 7 * 60 + i * 30;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

function addMinutesToTime(hhmm: string, minutesToAdd: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min((h || 0) * 60 + (m || 0) + minutesToAdd, 24 * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function PaymentConfirmPanel({
  bookingId,
  totalCents,
  onSuccess,
  onError,
}: {
  bookingId: string;
  totalCents: number | null | undefined;
  onSuccess: (message: string, confirmationUrl?: string) => void;
  onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setConfirming(true);
    onError("");
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });
      if (error) {
        onError(error.message || "We couldn't place the hold on your card.");
        return;
      }
      const status = paymentIntent?.status ?? "unknown";
      if (status === "requires_capture") {
        // The request (and the host alert + guest email) only goes in once the server has
        // confirmed the authorized hold with Stripe.
        const res = await fetch(`/api/v1/bookings/${bookingId}/authorize`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          onError(data.message || "The hold was placed on your card, but we couldn't submit the request.");
          return;
        }
        onSuccess(
          "Hold placed and request sent. Your card is only charged if we confirm your booking.",
          typeof data.confirmationUrl === "string" ? data.confirmationUrl : undefined
        );
      } else {
        onError(`Unexpected card hold status: ${status}`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "We couldn't place the hold on your card.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      <Button
        type="button"
        variant="accent"
        fullWidth
        onClick={() => void handleConfirm()}
        disabled={!stripe || !elements || confirming}
        data-testid="request-hold-button"
      >
        {confirming ? "Placing hold…" : holdButtonLabel(totalCents)}
      </Button>
    </div>
  );
}

export default function SpacePage() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [space, setSpace] = useState<SpacePublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(() => nextWeekdayChicago());
  const [endDate, setEndDate] = useState(() => nextWeekdayChicago());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [parkingPasses, setParkingPasses] = useState(0);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** The booking hold + its Stripe PaymentIntent — created inline, in the same card, once the quote and guest fields are valid. */
  const [hold, setHold] = useState<{ bookingId: string; clientSecret: string; totalCents: number } | null>(null);
  /** Only the newest quote response may land (an older, slower one must not overwrite it). */
  const quoteSeqRef = useRef(0);
  /** Idempotency key for the current checkout attempt; renewed after "Change details". */
  const requestKeyRef = useRef<string>(newRequestKey());
  /** Synchronous guard so a fast double click can't fire two create calls before re-render. */
  const submittingRef = useRef(false);
  const [discarding, setDiscarding] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/v1/spaces/${slug}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).message || "Failed to load");
        return r.json();
      })
      .then((s) => setSpace(s))
      .catch((e) => setError(e.message));
  }, [slug]);

  // Arriving with /spaces/<slug>#reserve (e.g. from a home card): the form renders only after the
  // space loads, so the browser's own hash jump has nothing to land on. Do it once it exists.
  const didHashScrollRef = useRef(false);
  useEffect(() => {
    if (!space || didHashScrollRef.current) return;
    const h = window.location.hash;
    if (h !== `#${RESERVE_ANCHOR}` && h !== "#booking") return;
    didHashScrollRef.current = true;
    requestAnimationFrame(() => scrollToReserve({ smooth: false }));
  }, [space]);

  // Keep the end date from drifting before the start date when the guest edits the start date.
  useEffect(() => {
    if (endDate < date) setEndDate(date);
  }, [date, endDate]);

  const minHours = space?.pricing.minHours ?? 1;

  const minEndTime = useMemo(
    () => addMinutesToTime(normalizeTime(startTime) || "07:00", minHours * 60),
    [startTime, minHours]
  );

  const endTimeOptions = useMemo(
    () => TIME_OPTIONS.filter((t) => t >= minEndTime),
    [minEndTime]
  );

  useEffect(() => {
    if (endTimeOptions.length && !endTimeOptions.includes(endTime)) {
      setEndTime(endTimeOptions[0]);
    }
  }, [endTimeOptions, endTime]);

  const isMultiDay = endDate > date;

  const windowIso = useMemo(() => {
    if (!date || !space) return null;
    // Build local Chicago wall times as ISO by appending offset approximation via Date parsing as local —
    // For MVP UI we send as America/Chicago wall clock with -06:00/-05:00 naive: use Date constructed and toISOString.
    const start = normalizeTime(startTime);
    const end = normalizeTime(endTime);
    const startsAt = new Date(`${date}T${start}:00`);
    const endsAt = new Date(`${date}T${end}:00`);
    const endDateInstant = isMultiDay ? new Date(`${endDate}T${end}:00`) : null;
    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      endDate: endDateInstant ? endDateInstant.toISOString() : undefined,
    };
  }, [date, endDate, isMultiDay, startTime, endTime, space]);

  const refreshQuote = useCallback(async () => {
    if (!space || !windowIso || hold) return;
    const seq = ++quoteSeqRef.current;
    setQuoteError(null);
    const res = await fetch(`/api/v1/spaces/${space.id}/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startsAt: windowIso.startsAt,
        endsAt: windowIso.endsAt,
        endDate: windowIso.endDate,
        parkingPasses,
      }),
    });
    const data = await res.json();
    if (seq !== quoteSeqRef.current) return; // superseded by a newer quote request
    if (!res.ok) {
      setQuote(null);
      setQuoteError(data.message || data.error);
      return;
    }
    setQuote(data);
  }, [space, windowIso, parkingPasses, hold]);

  useEffect(() => {
    if (windowIso && space && !hold) void refreshQuote();
  }, [windowIso, space, parkingPasses, hold, refreshQuote]);

  async function createHold(e?: FormEvent | MouseEvent) {
    e?.preventDefault();
    if (!space || !windowIso || hold || submitting || submittingRef.current) return;
    if (!date) {
      setError("Pick a date.");
      return;
    }
    if (!normalizeTime(startTime) || !normalizeTime(endTime)) {
      setError("Pick a start and end time (use the time picker).");
      return;
    }
    if (!guestName.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!isValidEmail(guestEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!quote) {
      setError("Fix the date/time above to get a quote first.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setPaymentMessage(null);
    setPaymentError(null);
    try {
      const res = await fetch("/api/v1/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId: space.id,
          startsAt: windowIso.startsAt,
          endsAt: windowIso.endsAt,
          endDate: windowIso.endDate,
          parkingPasses,
          guestNotes: notes,
          guest: { name: guestName, email: guestEmail, phone: guestPhone || undefined },
          clientRequestKey: requestKeyRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.message || data.error || `Booking failed (HTTP ${res.status})`
        );
      }
      // The hold amount is whatever the server actually authorized for this booking.
      setHold({
        bookingId: data.booking.id,
        clientSecret: data.stripe.clientSecret,
        totalCents: Number(data.booking.totalCents),
      });
      // Demo mode authorizes straight away; go to the "Request received" page like a real checkout.
      if (typeof data.confirmationUrl === "string") router.push(data.confirmationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  /** "Change details": drop the unpaid draft (cancels its PaymentIntent) and unlock the form. */
  async function changeDetails() {
    if (!hold || paymentMessage || discarding) return;
    setDiscarding(true);
    try {
      await fetch(`/api/v1/bookings/${hold.bookingId}/discard`, { method: "POST" }).catch(() => undefined);
    } finally {
      requestKeyRef.current = newRequestKey();
      setHold(null);
      setPaymentError(null);
      setError(null);
      setDiscarding(false);
    }
  }

  if (error && !space) {
    return <Alert tone="danger">{error}</Alert>;
  }
  if (!space) {
    return <p className="text-cue-stone-500">Loading space…</p>;
  }

  const fieldsLocked = !!hold;

  const discountPct = space.pricing.longBookingDiscountBps / 100;

  return (
    <>
      {/* Hero — compact single-row banner on desktop, stacked on mobile */}
      <FullBleed className="-mt-10 bg-cue-navy-700">
        <div className="mx-auto flex max-w-[920px] flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-6">
          <div>
            <p className="cue-eyebrow text-cue-copper-300">
              {space.location ? `${space.location.city} · ${space.location.name}` : space.city}
            </p>
            <h1 className="mt-1 text-[clamp(20px,2.6vw,28px)] text-white">{space.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
              <span className="flex items-center gap-1.5">
                <Users aria-hidden className="h-4 w-4" />
                {capacityLabel(space)}
              </span>
              <span>
                {formatRate(space.pricing.baseHourlyCents)} / hr · {space.pricing.minHours}-hr minimum
              </span>
              {discountPct > 0 && (
                <span className="text-cue-copper-300">
                  {discountPct}% off {space.pricing.longBookingThresholdHours}+ hours
                </span>
              )}
            </p>
          </div>
          <RequestToBookButton className="rounded-full px-8" testId="request-to-book-hero" />
        </div>
      </FullBleed>

      {/* Gallery + about + amenities */}
      <FullBleed className="bg-white">
        <div className="mx-auto max-w-[920px] space-y-10 px-4 py-14 sm:px-6">
          <div className="overflow-hidden rounded-card shadow-sm">
            <RoomGallery space={space} />
          </div>

          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl">About {roomCode(space)}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cue-stone-700">
                  {space.description}
                </p>
              </div>
              <RequestToBookButton testId="request-to-book-about" />
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="cue-chip">
                <MapPin aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                {space.location
                  ? `${space.location.city} · ${space.location.name}`
                  : `${space.city}${space.neighborhood ? ` · ${space.neighborhood}` : ""}`}
              </span>
              <span className="cue-chip">
                <Clock aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                Mon–Fri 7:00–18:00 ({space.timezone})
              </span>
            </div>
            {space.amenities.length > 0 && (
              <div>
                <h3 className="mb-3 text-sm font-semibold text-cue-navy-600">Amenities</h3>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {space.amenities.map((a) => (
                    <AmenityTile key={a.key} amenityKey={a.key} label={a.label} />
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-cue-navy-600">Parking</h3>
                <p className="text-sm leading-relaxed text-cue-stone-700">
                  Parking is not available under the building unless pre-booked. Public parking
                  is across the street at{" "}
                  <a href={PARKING_MAPS_URL} target="_blank" rel="noopener noreferrer">
                    720 N. Ervay St, Dallas, TX 75201
                  </a>
                  .
                </p>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-cue-navy-600">Food &amp; drinks</h3>
                <p className="text-sm leading-relaxed text-cue-stone-700">
                  Outside food welcome. Feel free to have food delivered or catered; Mendocino
                  Farms is just down the street.
                </p>
              </div>
            </div>
          </div>
        </div>
      </FullBleed>

      {/* Booking */}
      <FullBleed className="bg-cue-stone-100">
        {/* Legacy #booking links still land here. */}
        <span id="booking" aria-hidden className="block scroll-mt-[74px]" />
        {/* #reserve: scroll-margin-top equals the 74px sticky header; the section padding gives the space (works without JS too). */}
        <div id={RESERVE_ANCHOR} className="mx-auto max-w-[760px] scroll-mt-[74px] px-4 py-14 sm:px-6">
          <form
            noValidate
            onSubmit={createHold}
            className="cue-card space-y-4 p-6 sm:p-8"
          >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl">Reserve {roomCode(space)}</h2>
            {isTestOrMockStripe && <Badge tone="warning">Test mode</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-cue-stone-500">Date</span>
              <input
                type="date"
                value={date}
                disabled={fieldsLocked}
                onChange={(e) => setDate(e.target.value)}
                className="cue-input"
                aria-label="Date"
                data-reserve-first-field
              />
            </label>
            <label className="block text-sm">
              <span className="text-cue-stone-500">End date</span>
              <input
                type="date"
                value={endDate}
                min={date}
                disabled={fieldsLocked}
                onChange={(e) => setEndDate(e.target.value)}
                className="cue-input"
                aria-label="End date"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-cue-stone-500">Start</span>
              <select
                value={startTime}
                disabled={fieldsLocked}
                onChange={(e) => setStartTime(e.target.value)}
                className="cue-select"
                aria-label="Start time"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={`s-${t}`} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-cue-stone-500">End</span>
              <select
                value={endTime}
                disabled={fieldsLocked}
                onChange={(e) => setEndTime(e.target.value)}
                className="cue-select"
                aria-label="End time"
              >
                {endTimeOptions.map((t) => (
                  <option key={`e-${t}`} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-cue-stone-500">
            20% off for 8+ hours (whole reservation){isMultiDay ? " — each weekday in range is billed." : ""}
          </p>
          <label className="block text-sm">
            <span className="block text-cue-stone-500">
              Reserved parking under the building, $20 per person per day
            </span>
            <select
              value={parkingPasses}
              disabled={fieldsLocked}
              onChange={(e) => setParkingPasses(Number(e.target.value))}
              className="cue-input mt-1 w-full sm:w-56"
              aria-label="Number of parking passes"
            >
              {Array.from({ length: 21 }, (_, n) => (
                <option key={n} value={n}>
                  {n === 0 ? "No parking" : `${n} pass${n === 1 ? "" : "es"}`}
                </option>
              ))}
            </select>
          </label>
          <div
            data-testid="quote-panel"
            className="rounded-tile bg-cue-stone-100 p-3 text-sm"
          >
            {quoteError && <p className="text-cue-red-600">{quoteError}</p>}
            {quote && (
              <ul className="space-y-1">
                {quote.lineItems.map((li) => (
                  <li key={li.code} className="flex justify-between text-cue-stone-700">
                    <span>{li.label}</span>
                    <span>{money(li.amountCents)}</span>
                  </li>
                ))}
                <li
                  data-testid="quote-total"
                  className="flex justify-between border-t border-cue-stone-300 pt-2 font-semibold text-cue-navy-600"
                >
                  <span>Total</span>
                  <span>{money(quote.totalCents)}</span>
                </li>
              </ul>
            )}
            {!quote && !quoteError && (
              <p className="text-cue-stone-500">Select a date to see pricing</p>
            )}
          </div>
          <label className="block text-sm">
            <span className="text-cue-stone-500">Your name</span>
            <input
              value={guestName}
              disabled={fieldsLocked}
              onChange={(e) => setGuestName(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="block text-sm">
            <span className="text-cue-stone-500">Email</span>
            <input
              type="text"
              inputMode="email"
              autoComplete="email"
              value={guestEmail}
              disabled={fieldsLocked}
              onChange={(e) => setGuestEmail(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="block text-sm">
            <span className="text-cue-stone-500">Phone (optional)</span>
            <input
              value={guestPhone}
              disabled={fieldsLocked}
              onChange={(e) => setGuestPhone(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="block text-sm">
            <span className="text-cue-stone-500">Notes</span>
            <textarea
              value={notes}
              disabled={fieldsLocked}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="cue-input"
            />
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          {!hold ? (
            <>
              <HoldNotice totalCents={quote?.totalCents} />
              <Button
                type="button"
                variant="accent"
                fullWidth
                onClick={(e) => void createHold(e)}
                disabled={submitting || !quote}
              >
                {submitting ? "Preparing secure card form…" : "Continue to card details"}
              </Button>
            </>
          ) : (
            <div data-testid="hold-panel" className="space-y-3 border-t border-cue-stone-200 pt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {paymentMessage || isMockSecret(hold.clientSecret) ? (
                    <>
                      <Badge tone="warning">Hold placed</Badge>
                      <span className="text-xs text-cue-stone-500">awaiting host</span>
                    </>
                  ) : (
                    <>
                      <Badge tone="neutral">Card needed</Badge>
                      <span className="text-xs text-cue-stone-500">request not sent yet</span>
                    </>
                  )}
                </span>
                <span className="text-sm font-semibold text-cue-navy-600">{money(hold.totalCents)}</span>
              </div>
              {quote && quote.parkingCents > 0 && (
                <p className="text-xs text-cue-stone-500">
                  Includes parking: {quote.parkingPasses} pass{quote.parkingPasses === 1 ? "" : "es"} ·{" "}
                  {money(quote.parkingCents)}
                </p>
              )}
              {paymentMessage ? (
                <Alert tone="success" title="Hold placed – request sent">
                  {paymentMessage}
                </Alert>
              ) : isMockSecret(hold.clientSecret) ? (
                <p className="text-sm text-cue-stone-600">
                  Test mode — a mock card hold of {quote ? money(quote.totalCents) : "the quoted amount"}{" "}
                  was placed; no card is charged. Set{" "}
                  <code className="font-mono">STRIPE_SECRET_KEY</code> and{" "}
                  <code className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> for real test-mode
                  card collection.
                </p>
              ) : !stripePromise || !publishableKey ? (
                <Alert tone="danger">
                  Booking created, but{" "}
                  <code className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> is missing —
                  cannot load Stripe Payment Element.
                </Alert>
              ) : (
                <div className="space-y-3">
                  <HoldNotice totalCents={hold.totalCents} />
                  <p className="flex items-center gap-2 text-sm font-semibold text-cue-navy-600">
                    <CreditCard aria-hidden className="h-4 w-4" />
                    Card for the hold
                  </p>
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: hold.clientSecret,
                      appearance: { theme: "stripe" },
                    }}
                  >
                    <PaymentConfirmPanel
                      bookingId={hold.bookingId}
                      totalCents={hold.totalCents}
                      onSuccess={(msg, confirmationUrl) => {
                        setPaymentMessage(msg);
                        setPaymentError(null);
                        if (confirmationUrl) router.push(confirmationUrl);
                      }}
                      onError={(msg) => {
                        setPaymentError(msg || null);
                      }}
                    />
                  </Elements>
                </div>
              )}
              {paymentError && <Alert tone="danger">{paymentError}</Alert>}
              {!paymentMessage && !isMockSecret(hold.clientSecret) && (
                <button
                  type="button"
                  onClick={() => void changeDetails()}
                  disabled={discarding}
                  className="text-sm font-medium text-cue-copper-600 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {discarding ? "Reopening…" : "Change date, time or details"}
                </button>
              )}
              <p className="break-all text-xs text-cue-stone-400">Booking: {hold.bookingId}</p>
            </div>
          )}
        </form>
        </div>
      </FullBleed>

      {/* House rules, billing & cancellation */}
      {(space.hostRulesMd || space.cancellationPolicy) && (
        <FullBleed className="bg-cue-paper">
          <div className="mx-auto max-w-[920px] space-y-4 px-4 py-14 sm:px-6">
            {space.hostRulesMd && <HouseRules markdown={space.hostRulesMd} />}
            {space.cancellationPolicy && (
              <p className="text-xs text-cue-stone-500">
                Cancellation: <strong className="text-cue-stone-700">{space.cancellationPolicy.name}</strong> —
                free cancellation up to 48 hours before your booking; no refund after that. Staff
                respond within 24 hours; if not, your hold is released automatically.
              </p>
            )}
          </div>
        </FullBleed>
      )}

      {/* Questions / contact */}
      <FullBleed className="-mb-10 bg-white">
        <div className="mx-auto max-w-[920px] space-y-4 px-4 py-14 sm:px-6">
          <h2 className="text-2xl">Questions?</h2>
          <p className="text-sm text-cue-stone-700">
            D&apos;Arcy Young — <a href="tel:+12148834174">214-883-4174</a>, or stop by suite 212.
          </p>
          <ContactForm roomName={space.title} roomSlug={space.slug} />
        </div>
      </FullBleed>
    </>
  );
}
