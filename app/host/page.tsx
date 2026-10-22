"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Booking, Blockout, SpacePublic, StaffUser } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClasses } from "@/components/ui/Button";
import { formatMoney } from "@/lib/format";
import { isAcceptable } from "@/lib/booking-window";

function formatChicago(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

const STATUS_FILTERS = ["requested", "accepted", "declined", "cancelled", ""] as const;

const HOLD_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  requested: { label: "Hold placed", tone: "warning" },
  accepted: { label: "Captured", tone: "success" },
  completed: { label: "Captured", tone: "success" },
  declined: { label: "Released", tone: "neutral" },
  cancelled: { label: "Released", tone: "neutral" },
  expired: { label: "Released", tone: "neutral" },
  draft: { label: "Not authorized", tone: "neutral" },
  in_progress: { label: "Captured", tone: "success" },
};

function holdStatus(b: Pick<Booking, "status" | "cancellationAction" | "refundCents">): { label: string; tone: BadgeTone } {
  if (b.status === "cancelled" && b.cancellationAction === "refund" && b.refundCents) {
    return { label: `Refunded ${formatMoney(b.refundCents)}`, tone: "neutral" };
  }
  if (b.status === "cancelled" && b.cancellationAction === "no_refund") {
    return { label: "Captured · no refund", tone: "neutral" };
  }
  return HOLD_STATUS[b.status] ?? { label: b.status, tone: "neutral" };
}

type CancelPreview = { cancellable: boolean; action?: "release_hold" | "refund" | "no_refund"; refundCents: number; summary: string };

function previewLabel(p: CancelPreview | undefined): string {
  if (!p) return "…";
  if (p.action === "release_hold") return "Release hold — guest was never charged";
  if (p.action === "refund") return `Full refund ${formatMoney(p.refundCents)}`;
  return "No refund (inside 48h)";
}

export default function HostPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("requested");
  const [boStart, setBoStart] = useState("");
  const [boEnd, setBoEnd] = useState("");
  const [boReason, setBoReason] = useState("");
  const [spaces, setSpaces] = useState<SpacePublic[]>([]);
  const [blockoutSpaceId, setBlockoutSpaceId] = useState("");
  const [calendarWarning, setCalendarWarning] = useState<{ bookingId: string; message: string } | null>(
    null
  );

  const headers = useCallback(() => ({ "Content-Type": "application/json" }), []);

  useEffect(() => {
    fetch("/api/v1/staff/me")
      .then(async (r) => {
        if (!r.ok) {
          router.replace("/staff/login?next=/host");
          return;
        }
        const data = await r.json();
        setStaff(data.staff);
      })
      .catch(() => router.replace("/staff/login?next=/host"))
      .finally(() => setCheckingAuth(false));
  }, [router]);

  async function signOut() {
    await fetch("/api/v1/staff/logout", { method: "POST" });
    router.replace("/staff/login");
  }

  useEffect(() => {
    if (!staff) return;
    fetch("/api/v1/spaces")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || "Failed to load spaces");
        const liveSpaces: SpacePublic[] = data.data ?? [];
        setSpaces(liveSpaces);
        setBlockoutSpaceId((prev) => prev || liveSpaces[0]?.id || "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [staff]);

  const load = useCallback(async () => {
    if (!staff) return;
    setError(null);
    try {
      const spaceId = blockoutSpaceId;
      const q = statusFilter ? `?status=${statusFilter}` : "";
      const [bRes, xRes] = await Promise.all([
        fetch(`/api/v1/host/bookings${q}`, { headers: headers() }),
        spaceId
          ? fetch(`/api/v1/host/blockouts?spaceId=${spaceId}`, {
              headers: headers(),
            })
          : Promise.resolve(null),
      ]);
      if (bRes.status === 401) {
        router.replace("/staff/login?next=/host");
        return;
      }
      const bData = await bRes.json();
      if (!bRes.ok) throw new Error(bData.message || "Failed to load bookings");
      setBookings(bData.data);
      if (xRes) {
        const xData = await xRes.json();
        if (!xRes.ok) throw new Error(xData.message || "Failed to load blockouts");
        setBlockouts(xData.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [headers, statusFilter, blockoutSpaceId, staff, router]);

  useEffect(() => {
    void load();
  }, [load]);

  /** "Now", refreshed every minute so a request flips to not-acceptable once its start passes. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelPreview, setCancelPreview] = useState<{ policy: CancelPreview; courtesy: CancelPreview } | null>(null);
  const [courtesy, setCourtesy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function openCancel(b: Booking) {
    setCancelTarget(b);
    setCancelPreview(null);
    setCourtesy(false);
    setCancelError(null);
    const res = await fetch(`/api/v1/host/bookings/${b.id}/cancel`, { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCancelError(data.message || "Couldn't load the refund preview");
      return;
    }
    setCancelPreview({ policy: data.policy, courtesy: data.courtesy });
  }

  async function confirmCancel() {
    if (!cancelTarget || cancelBusy) return;
    setCancelBusy(true);
    setCancelError(null);
    const res = await fetch(`/api/v1/host/bookings/${cancelTarget.id}/cancel`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ courtesyFullRefund: courtesy }),
    });
    const data = await res.json().catch(() => ({}));
    setCancelBusy(false);
    if (!res.ok) {
      setCancelError(data.message || "Cancel failed");
      return;
    }
    const outcome =
      data.action === "release_hold"
        ? "hold released"
        : data.action === "refund"
          ? `refunded ${formatMoney(data.refundCents)}`
          : "no refund";
    setNotice(`Booking ${cancelTarget.id} cancelled — ${outcome}. Guest and host have been emailed.`);
    setCancelTarget(null);
    await load();
  }

  async function act(bookingId: string, action: "accept" | "decline") {
    setError(null);
    const res = await fetch(`/api/v1/host/bookings/${bookingId}/${action}`, {
      method: "POST",
      headers: headers(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || "Action failed");
      return;
    }
    if (data.calendarSyncWarning) {
      setCalendarWarning({ bookingId, message: data.calendarSyncWarning });
    } else {
      setCalendarWarning(null);
    }
    await load();
  }

  async function createBlockout(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/host/blockouts", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        spaceId: blockoutSpaceId || spaces[0]?.id,
        startsAt: new Date(boStart).toISOString(),
        endsAt: new Date(boEnd).toISOString(),
        reason: boReason || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message || "Blockout failed");
      return;
    }
    setBoStart("");
    setBoEnd("");
    setBoReason("");
    await load();
  }

  async function removeBlockout(id: string) {
    const res = await fetch(`/api/v1/host/blockouts/${id}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      setError(data.message || "Delete failed");
      return;
    }
    await load();
  }

  if (checkingAuth) {
    return <p className="text-cue-stone-500">Checking sign-in…</p>;
  }
  if (!staff) {
    return null;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="cue-eyebrow">Staff</p>
          <h1 className="mt-2 text-3xl">Host queue</h1>
          <p className="mt-1 text-sm text-cue-stone-500">
            Signed in as <span className="text-cue-navy-600">{staff.name}</span> ({staff.email})
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && (
        <Alert tone="success" title="Cancelled" onDismiss={() => setNotice(null)} data-testid="cancel-notice">
          {notice}
        </Alert>
      )}

      {calendarWarning && (
        <Alert tone="warning" title="Calendar sync warning" onDismiss={() => setCalendarWarning(null)}>
          Booking {calendarWarning.bookingId}: {calendarWarning.message}
        </Alert>
      )}

      <div className="inline-flex gap-1 rounded-pill bg-cue-stone-100 p-1">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-pill px-3.5 py-1.5 text-sm font-medium capitalize transition-colors ${
              statusFilter === s
                ? "bg-cue-navy-600 text-white"
                : "text-cue-stone-500 hover:text-cue-navy-600"
            }`}
          >
            {s || "all"}
          </button>
        ))}
      </div>

      <section data-testid="host-queue" className="space-y-3">
        <h2 className="text-2xl">Bookings</h2>
        {bookings.length === 0 && (
          <p className="text-sm text-cue-stone-500">
            No bookings here yet — try a different tab, or check back once a guest requests a room.
          </p>
        )}
        {bookings.map((b) => {
          const hold = holdStatus(b);
          // A request whose start time has passed (CT) can't be accepted; only Decline is offered.
          const startPassed = b.status === "requested" && !isAcceptable(b, now);
          const code = b.spaceShortTitle || b.spaceSlug?.split("-").pop() || b.spaceTitle || "Room";
          return (
            <div key={b.id} className="cue-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold text-cue-navy-600">
                    {code}
                    {b.locationName ? ` · ${b.locationName}` : ""}
                  </div>
                  <div className="text-sm text-cue-stone-700">
                    {formatChicago(b.startsAt)} – {formatChicago(b.endsAt)} CT
                  </div>
                  <div className="text-sm text-cue-stone-500">
                    {b.guestName || "Guest"}
                    {b.guestEmail ? ` · ${b.guestEmail}` : ""} · {formatMoney(b.totalCents)}
                    {b.parkingPasses
                      ? ` · parking: ${b.parkingPasses} pass${b.parkingPasses === 1 ? "" : "es"}/day (${formatMoney(b.parkingCents ?? 0)})`
                      : ""}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Badge tone="neutral">{b.status}</Badge>
                    <Badge tone={hold.tone}>{hold.label}</Badge>
                    {startPassed && (
                      <span data-testid={`start-passed-${b.id}`}>
                        <Badge tone="warning">Start time passed — can&apos;t accept</Badge>
                      </span>
                    )}
                  </div>
                  <div className="break-all text-xs text-cue-stone-400">{b.id}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.status === "requested" && (
                    <>
                      {!startPassed && (
                        <Button
                          type="button"
                          variant="primary"
                          data-testid={`accept-${b.id}`}
                          onClick={() => act(b.id, "accept")}
                        >
                          Accept
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        data-testid={`decline-${b.id}`}
                        onClick={() => act(b.id, "decline")}
                      >
                        Decline
                      </Button>
                    </>
                  )}
                  {(b.status === "requested" || b.status === "accepted") && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-cue-red-600!"
                      data-testid={`cancel-${b.id}`}
                      onClick={() => void openCancel(b)}
                    >
                      Cancel booking
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {cancelTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-cue-navy-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
          data-testid="cancel-dialog"
        >
          <div className="cue-card w-full max-w-md space-y-4 bg-white p-6">
            <div>
              <p className="cue-eyebrow">Cancel booking</p>
              <h2 id="cancel-dialog-title" className="mt-1 text-2xl">
                Cancel {cancelTarget.spaceShortTitle || cancelTarget.spaceTitle || "booking"}?
              </h2>
              <p className="mt-1 text-sm text-cue-stone-700">
                {formatChicago(cancelTarget.startsAt)} – {formatChicago(cancelTarget.endsAt)} CT ·{" "}
                {cancelTarget.guestName || "Guest"} · {formatMoney(cancelTarget.totalCents)} ({cancelTarget.status})
              </p>
            </div>
            <div className="rounded-tile border border-cue-copper-300 bg-cue-copper-050 p-4 text-sm" data-testid="cancel-dialog-refund">
              <div className="text-cue-stone-500">Policy outcome</div>
              <div className="mt-0.5 font-semibold text-cue-navy-600">{previewLabel(cancelPreview?.policy)}</div>
              {courtesy && cancelPreview && (
                <div className="mt-2 font-semibold text-cue-copper-600" data-testid="cancel-dialog-courtesy-amount">
                  With courtesy override: {previewLabel(cancelPreview.courtesy)}
                </div>
              )}
            </div>
            {cancelTarget.status === "accepted" && (
              <label className="flex items-start gap-2 text-sm text-cue-stone-700">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={courtesy}
                  onChange={(e) => setCourtesy(e.target.checked)}
                  data-testid="cancel-courtesy"
                />
                <span>
                  <strong className="text-cue-navy-600">Full refund regardless</strong> (courtesy) — refund the full{" "}
                  {formatMoney(cancelTarget.totalCents)} even if the 48h policy says otherwise.
                </span>
              </label>
            )}
            <p className="text-xs text-cue-stone-500">
              The guest gets a cancellation email, the host is alerted, and the calendar slot is freed. This can&apos;t be undone.
            </p>
            {cancelError && <Alert tone="danger">{cancelError}</Alert>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCancelTarget(null)} disabled={cancelBusy}>
                Keep booking
              </Button>
              <Button
                type="button"
                variant="accent"
                onClick={() => void confirmCancel()}
                disabled={cancelBusy || !cancelPreview}
                data-testid="cancel-dialog-confirm"
              >
                {cancelBusy ? "Cancelling…" : "Yes, cancel booking"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-2xl">Blockouts</h2>
        <form onSubmit={createBlockout} className="cue-card grid gap-3 p-5 md:grid-cols-5">
          <label className="text-sm md:col-span-1">
            <span className="text-cue-stone-500">Space</span>
            <select
              value={blockoutSpaceId}
              onChange={(e) => setBlockoutSpaceId(e.target.value)}
              className="cue-select"
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.location?.name ? ` · ${s.location.name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-1">
            <span className="text-cue-stone-500">Starts</span>
            <input
              type="datetime-local"
              required
              value={boStart}
              onChange={(e) => setBoStart(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="text-sm md:col-span-1">
            <span className="text-cue-stone-500">Ends</span>
            <input
              type="datetime-local"
              required
              value={boEnd}
              onChange={(e) => setBoEnd(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="text-sm md:col-span-1">
            <span className="text-cue-stone-500">Reason</span>
            <input
              value={boReason}
              onChange={(e) => setBoReason(e.target.value)}
              className="cue-input"
            />
          </label>
          <div className="flex items-end">
            <Button type="submit" variant="primary" fullWidth>
              Add Blockout
            </Button>
          </div>
        </form>
        {blockouts.map((x) => (
          <div key={x.id} className="cue-card flex items-center justify-between px-4 py-3 text-sm">
            <div className="text-cue-stone-700">
              {formatChicago(x.startsAt)} – {formatChicago(x.endsAt)} CT
              {x.reason ? ` · ${x.reason}` : ""}
            </div>
            <button
              type="button"
              onClick={() => removeBlockout(x.id)}
              className={buttonClasses("ghost", "px-3! py-1.5! text-cue-red-600 hover:bg-cue-red-100!")}
            >
              Remove
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
