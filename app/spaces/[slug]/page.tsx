"use client";

import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useParams } from "next/navigation";
import type { Quote, SpacePublic } from "@/lib/types";
import HouseRules from "@/components/HouseRules";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

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
      <button
        type="button"
        onClick={() => void handleConfirm()}
        disabled={!stripe || !elements || confirming}
        className="btn-accent w-full disabled:opacity-50"
      >
        {confirming ? "Confirming…" : "Confirm payment"}
      </button>
    </div>
  );
}

export default function SpacePage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [space, setSpace] = useState<SpacePublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
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

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/v1/spaces/${slug}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).message || "Failed to load");
        return r.json();
      })
      .then(setSpace)
      .catch((e) => setError(e.message));
  }, [slug]);

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
    return <p className="font-light text-danger">{error}</p>;
  }
  if (!space) {
    return <p className="font-light text-cue-muted">Loading space…</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <section className="lg:col-span-3 space-y-6">
        <div className="cue-card overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={space.photos[0]?.url}
            alt={space.photos[0]?.alt || space.title}
            className="h-60 w-full object-cover"
          />
          <div className="space-y-4 p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl text-cue-navy">{space.title}</h1>
                <p className="font-light text-cue-muted">{space.subtitle}</p>
              </div>
              <div className="rounded-xl bg-cue-navy/5 px-3 py-2 text-right">
                <div className="text-lg font-bold text-cue-navy">
                  {money(space.pricing.baseHourlyCents)}
                </div>
                <div className="text-xs font-light text-cue-navy-soft">per hour</div>
              </div>
            </div>
            <p className="text-sm font-light leading-relaxed text-cue-muted">{space.description}</p>
            <div className="flex flex-wrap gap-2">
              <span className="cue-chip">
                {space.location
                  ? `${space.location.city} · ${space.location.name}`
                  : `${space.city}${space.neighborhood ? ` · ${space.neighborhood}` : ""}`}
              </span>
              <span className="cue-chip">
                Capacity {space.capacity}
              </span>
              <span className="cue-chip">
                Mon–Fri 7:00–18:00 ({space.timezone})
              </span>
              <span className="cue-chip">
                Request to book
              </span>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-bold text-cue-navy">Amenities</h2>
              <ul className="flex flex-wrap gap-2">
                {space.amenities.map((a) => (
                  <li
                    key={a.key}
                    className="rounded-md border border-cue-navy/10 px-2 py-1 text-xs font-light text-cue-muted"
                  >
                    {a.label}
                  </li>
                ))}
              </ul>
            </div>
            {space.hostRulesMd && (
              <HouseRules markdown={space.hostRulesMd} />
            )}
            {space.cancellationPolicy && (
              <p className="text-xs font-light text-cue-muted">
                Cancellation: <strong>{space.cancellationPolicy.name}</strong> — full
                refund ≥7 days before; 50% ≥24h before; grace within 24h of confirm if
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
          className="cue-card sticky top-6 space-y-4 p-6"
        >
          <h2 className="text-2xl text-cue-navy">Request a booking</h2>
          <label className="block text-sm">
            <span className="font-light text-cue-muted">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="cue-input"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-light text-cue-muted">Start</span>
              <select
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="cue-input"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={`s-${t}`} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-light text-cue-muted">End</span>
              <select
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="cue-input"
              >
                {TIME_OPTIONS.map((t) => (
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
                <span className="font-medium">{space.addons[0].name}</span>
                <span className="block text-xs font-light text-cue-muted">
                  {money(space.addons[0].priceCents)}/day
                </span>
              </span>
            </label>
          )}
          <div className="rounded-xl bg-cue-wash p-3 text-sm">
            {quoteError && <p className="text-danger">{quoteError}</p>}
            {quote && (
              <ul className="space-y-1">
                {quote.lineItems.map((li) => (
                  <li key={li.code} className="flex justify-between font-light text-cue-ink">
                    <span>{li.label}</span>
                    <span>{money(li.amountCents)}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-cue-navy/10 pt-2 font-bold text-cue-navy">
                  <span>Total</span>
                  <span>{money(quote.totalCents)}</span>
                </li>
              </ul>
            )}
            {!quote && !quoteError && (
              <p className="font-light text-cue-muted">Select a date to see pricing</p>
            )}
          </div>
          <label className="block text-sm">
            <span className="font-light text-cue-muted">Your name</span>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="block text-sm">
            <span className="font-light text-cue-muted">Email</span>
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
            <span className="font-light text-cue-muted">Phone (optional)</span>
            <input
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="block text-sm">
            <span className="font-light text-cue-muted">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="cue-input"
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          {result ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-cue-green/40 bg-cue-green/10 p-3 text-sm text-cue-navy">
                <p className="font-medium">Request created</p>
                <p className="mt-1 break-all">Booking: {result.bookingId}</p>
                <p className="mt-2 text-xs">
                  Payment uses manual capture — host accept will capture the hold.
                </p>
              </div>

              {isMockSecret(result.clientSecret) ? (
                <div className="rounded-xl border border-cue-gold/50 bg-cue-gold/15 p-3 text-sm text-cue-ink">
                  <p className="font-medium">Demo mode</p>
                  <p className="mt-1 text-xs">
                    Stripe keys are unset, so this booking used a mock PaymentIntent.
                    Set <code className="font-mono">STRIPE_SECRET_KEY</code> and{" "}
                    <code className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>{" "}
                    for real test-mode card collection.
                  </p>
                  <p className="mt-1 break-all text-xs opacity-70">
                    {result.clientSecret}
                  </p>
                </div>
              ) : !stripePromise || !publishableKey ? (
                <div className="rounded-xl border border-danger/30 bg-red-50 p-3 text-sm text-danger">
                  Booking created, but{" "}
                  <code className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>{" "}
                  is missing — cannot load Stripe Payment Element.
                </div>
              ) : paymentMessage ? (
                <div className="rounded-xl border border-cue-green/40 bg-cue-green/10 p-3 text-sm text-cue-navy">
                  <p className="font-medium">Payment confirmed</p>
                  <p className="mt-1">{paymentMessage}</p>
                </div>
              ) : (
                <div className="space-y-2 rounded-xl border border-cue-navy/10 p-3">
                  <p className="text-sm font-bold text-cue-navy">
                    Enter payment details
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
                  {paymentError && (
                    <p className="text-sm text-danger">{paymentError}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => void submitBooking(e)}
              disabled={submitting || !quote}
              className="btn-accent w-full disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Request to book"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
