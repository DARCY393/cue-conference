"use client";

import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useParams } from "next/navigation";
import { Clock, CreditCard, MapPin, Users } from "lucide-react";
import type { Quote, SpacePublic } from "@/lib/types";
import HouseRules from "@/components/HouseRules";
import { AmenityTile } from "@/components/ui/AmenityTile";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { formatMoney, formatRate, roomCode } from "@/lib/format";

const money = formatMoney;

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

function RoomPlaceholder({ code, capacity }: { code: string; capacity: number }) {
  return (
    <div className="flex h-60 w-full flex-col items-center justify-center gap-1 bg-cue-stone-100">
      <span className="font-display text-5xl text-cue-navy-600">{code}</span>
      <span className="text-sm text-cue-stone-500">{capacity} seats</span>
    </div>
  );
}

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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
  onSuccess,
  onError,
}: {
  onSuccess: (message: string) => void;
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
        onError(error.message || "Payment confirmation failed");
        return;
      }
      const status = paymentIntent?.status ?? "unknown";
      if (
        status === "requires_capture" ||
        status === "succeeded" ||
        status === "processing"
      ) {
        onSuccess(
          status === "requires_capture"
            ? "Card authorized. Host accept will capture the hold."
            : `Payment ${status}.`
        );
      } else {
        onError(`Unexpected payment status: ${status}`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Payment confirmation failed");
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
      >
        {confirming ? "Confirming…" : "Confirm Payment"}
      </Button>
    </div>
  );
}

export default function SpacePage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [space, setSpace] = useState<SpacePublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(() => nextWeekdayChicago());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [imgError, setImgError] = useState(false);
  const [parking, setParking] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    bookingId: string;
    clientSecret: string;
  } | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const checkoutRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/v1/spaces/${slug}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).message || "Failed to load");
        return r.json();
      })
      .then((s) => {
        setImgError(false);
        setSpace(s);
      })
      .catch((e) => setError(e.message));
  }, [slug]);

  useEffect(() => {
    if (result) checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

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

  const windowIso = useMemo(() => {
    if (!date || !space) return null;
    // Build local Chicago wall times as ISO by appending offset approximation via Date parsing as local —
    // For MVP UI we send as America/Chicago wall clock with -06:00/-05:00 naive: use Date constructed and toISOString.
    const start = normalizeTime(startTime);
    const end = normalizeTime(endTime);
    const startsAt = new Date(`${date}T${start}:00`);
    const endsAt = new Date(`${date}T${end}:00`);
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }, [date, startTime, endTime, space]);

  const refreshQuote = useCallback(async () => {
    if (!space || !windowIso) return;
    setQuoteError(null);
    const addons = parking
      ? [{ addonId: space.addons[0]?.id, quantity: 1 }]
      : [];
    const res = await fetch(`/api/v1/spaces/${space.id}/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startsAt: windowIso.startsAt,
        endsAt: windowIso.endsAt,
        addons: addons.filter((a) => a.addonId),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setQuote(null);
      setQuoteError(data.message || data.error);
      return;
    }
    setQuote(data);
  }, [space, windowIso, parking]);

  useEffect(() => {
    if (windowIso && space) void refreshQuote();
  }, [windowIso, space, parking, refreshQuote]);

  async function submitBooking(e?: FormEvent | MouseEvent) {
    e?.preventDefault();
    if (!space || !windowIso) return;
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
    setSubmitting(true);
    setError(null);
    setPaymentMessage(null);
    setPaymentError(null);
    try {
      const addons = parking
        ? [{ addonId: space.addons[0]?.id, quantity: 1 }]
        : [];
      const res = await fetch("/api/v1/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId: space.id,
          startsAt: windowIso.startsAt,
          endsAt: windowIso.endsAt,
          addons: addons.filter((a) => a.addonId),
          guestNotes: notes,
          guest: { name: guestName, email: guestEmail, phone: guestPhone || undefined },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.message || data.error || `Booking failed (HTTP ${res.status})`
        );
      }
      setResult({
        bookingId: data.booking.id,
        clientSecret: data.stripe.clientSecret,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !space) {
    return <Alert tone="danger">{error}</Alert>;
  }
  if (!space) {
    return <p className="text-cue-stone-500">Loading space…</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <section className="lg:col-span-3 space-y-6">
        <div className="cue-card overflow-hidden">
          {space.photos[0]?.url && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={space.photos[0].url}
              alt={space.photos[0]?.alt || space.title}
              className="h-60 w-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <RoomPlaceholder code={roomCode(space)} capacity={space.capacity} />
          )}
          <div className="space-y-5 p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl">{space.title}</h1>
                <p className="mt-1 flex items-center gap-1.5 text-cue-stone-500">
                  <Users aria-hidden className="h-4 w-4" />
                  {space.capacity} seats · {space.location?.name ?? space.city}
                </p>
              </div>
              <div className="shrink-0 rounded-tile bg-cue-navy-050 px-3 py-2 text-right">
                <div className="text-lg font-semibold text-cue-navy-600">
                  {formatRate(space.pricing.baseHourlyCents)}
                </div>
                <div className="text-xs text-cue-stone-500">per hour</div>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-cue-stone-700">{space.description}</p>
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
              <Badge tone="navy">Request to book</Badge>
            </div>
            {space.amenities.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-cue-navy-600">Amenities</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {space.amenities.map((a) => (
                    <AmenityTile key={a.key} amenityKey={a.key} label={a.label} />
                  ))}
                </div>
              </div>
            )}
            {space.hostRulesMd && <HouseRules markdown={space.hostRulesMd} />}
            {space.cancellationPolicy && (
              <p className="text-xs text-cue-stone-500">
                Cancellation: <strong className="text-cue-stone-700">{space.cancellationPolicy.name}</strong> —
                full refund ≥7 days before; 50% ≥24h before; grace within 24h of confirm if
                start ≥48h away.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="lg:col-span-2">
        <form
          noValidate
          onSubmit={submitBooking}
          className="cue-card sticky top-[6.5rem] space-y-4 p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl">Request a booking</h2>
            {isTestOrMockStripe && <Badge tone="warning">Test mode</Badge>}
          </div>
          <label className="block text-sm">
            <span className="text-cue-stone-500">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="cue-input"
              aria-label="Date"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-cue-stone-500">Start</span>
              <select
                value={startTime}
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
          {space.addons[0] && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={parking}
                onChange={(e) => setParking(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-cue-ink">{space.addons[0].name}</span>
                <span className="block text-xs text-cue-stone-500">
                  {money(space.addons[0].priceCents)}/day
                </span>
              </span>
            </label>
          )}
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
              onChange={(e) => setGuestEmail(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="block text-sm">
            <span className="text-cue-stone-500">Phone (optional)</span>
            <input
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="block text-sm">
            <span className="text-cue-stone-500">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="cue-input"
            />
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
          {result ? (
            <div ref={checkoutRef} data-testid="checkout" className="space-y-3">
              <Alert tone="success" title="Request created">
                <p className="break-all">Booking: {result.bookingId}</p>
                <p className="mt-2 text-xs opacity-80">
                  Payment uses manual capture — host accept will capture the hold.
                </p>
              </Alert>

              {isMockSecret(result.clientSecret) ? (
                <Alert
                  tone="warning"
                  title="Test mode — no Stripe keys configured"
                  data-testid="stripe-test-alert"
                >
                  <p>
                    A mock card hold of {quote ? money(quote.totalCents) : "the quoted amount"} was
                    created; no card is charged. Set <code className="font-mono">STRIPE_SECRET_KEY</code>{" "}
                    and <code className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> for real
                    test-mode card collection.
                  </p>
                </Alert>
              ) : !stripePromise || !publishableKey ? (
                <Alert tone="danger">
                  Booking created, but{" "}
                  <code className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> is missing —
                  cannot load Stripe Payment Element.
                </Alert>
              ) : paymentMessage ? (
                <Alert tone="success" title="Payment confirmed">
                  {paymentMessage}
                </Alert>
              ) : (
                <div className="space-y-2 rounded-card border border-cue-stone-200 p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-cue-navy-600">
                    <CreditCard aria-hidden className="h-4 w-4" />
                    Enter payment details
                    {isTestOrMockStripe && <Badge tone="warning">Test mode</Badge>}
                  </p>
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: result.clientSecret,
                      appearance: { theme: "stripe" },
                    }}
                  >
                    <PaymentConfirmPanel
                      onSuccess={(msg) => {
                        setPaymentMessage(msg);
                        setPaymentError(null);
                      }}
                      onError={(msg) => {
                        setPaymentError(msg || null);
                      }}
                    />
                  </Elements>
                  {paymentError && <Alert tone="danger">{paymentError}</Alert>}
                </div>
              )}
            </div>
          ) : (
            <Button
              type="button"
              variant="accent"
              fullWidth
              onClick={(e) => void submitBooking(e)}
              disabled={submitting || !quote}
            >
              {submitting ? "Submitting…" : "Request Booking"}
            </Button>
          )}
        </form>
      </section>
    </div>
  );
}
