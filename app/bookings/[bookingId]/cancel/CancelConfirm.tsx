"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { cancellationOutcomeText } from "@/lib/cancellation";

type Outcome = { action: "release_hold" | "refund" | "no_refund"; refundCents: number };

export function CancelConfirm({
  bookingId,
  token,
  outcomeLabel,
  keepHref,
}: {
  bookingId: string;
  token: string;
  outcomeLabel: string;
  keepHref: string;
}) {

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Outcome | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.message || "We couldn't cancel this booking. Please try again or contact us.");
        setBusy(false);
        return;
      }
      setDone({ action: json.action, refundCents: json.refundCents });
      // Re-render the server page so it shows the stored outcome (survives a reload too).
      window.setTimeout(() => window.location.reload(), 1200);
    } catch {
      setError("Network error — please try again.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Alert tone="success" title="Booking cancelled" data-testid="cancel-done">
        {cancellationOutcomeText(done.action, done.refundCents)} We&apos;ve emailed you a confirmation.
      </Alert>
    );
  }

  return (
    <div className="space-y-4" data-testid="cancel-confirm">
      <p className="text-sm text-cue-stone-700">
        <strong className="font-semibold text-cue-navy-600">If you cancel now:</strong> {outcomeLabel}
      </p>
      {error && (
        <Alert tone="danger" title="Not cancelled" data-testid="cancel-error">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="accent" onClick={confirm} disabled={busy} data-testid="cancel-confirm-button">
          {busy ? "Cancelling…" : "Yes, cancel my booking"}
        </Button>
        <a href={keepHref} className="btn-secondary" data-testid="cancel-keep">
          Keep my booking
        </a>
      </div>
      <p className="text-xs text-cue-stone-500">This can&apos;t be undone.</p>
    </div>
  );
}
