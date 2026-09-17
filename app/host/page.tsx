"use client";

import { useCallback, useEffect, useState } from "react";
import type { Booking, Blockout, SpacePublic } from "@/lib/types";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function HostPage() {
  const [hostEmail, setHostEmail] = useState("host@example.com");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blockouts, setBlockouts] = useState<Blockout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("requested");
  const [boStart, setBoStart] = useState("");
  const [boEnd, setBoEnd] = useState("");
  const [boReason, setBoReason] = useState("");
  const [overtimeMins, setOvertimeMins] = useState(30);
  const [spaces, setSpaces] = useState<SpacePublic[]>([]);
  const [blockoutSpaceId, setBlockoutSpaceId] = useState("");

  const headers = useCallback(
    () => ({
      Authorization: `Bearer ${hostEmail}`,
      "Content-Type": "application/json",
    }),
    [hostEmail]
  );

  useEffect(() => {
    fetch("/api/v1/spaces")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || "Failed to load spaces");
        const liveSpaces: SpacePublic[] = data.data ?? [];
        setSpaces(liveSpaces);
        setBlockoutSpaceId((prev) => prev || liveSpaces[0]?.id || "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  const load = useCallback(async () => {
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
  }, [headers, statusFilter, blockoutSpaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string) {
    setError(null);
    const res = await fetch(path, { method: "POST", headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || "Action failed");
      return;
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

  async function chargeOt(bookingId: string) {
    const res = await fetch(`/api/v1/host/bookings/${bookingId}/overtime`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ extraMinutes: overtimeMins }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message || "Overtime failed");
      return;
    }
    alert(`Overtime ${money(data.amountCents)} — ${data.status}`);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl text-cue-navy">Host inbox</h1>
          <p className="mt-1 text-sm font-light text-cue-muted">
            Authenticate with <code className="rounded bg-cue-wash px-1.5 py-0.5 text-cue-navy">HOST_EMAIL</code>{" "}
            bearer token (default host@example.com).
          </p>
        </div>
        <label className="text-sm">
          Host email
          <input
            value={hostEmail}
            onChange={(e) => setHostEmail(e.target.value)}
            className="cue-input ml-2 !mt-0 w-auto min-w-[14rem]"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {["requested", "accepted", "declined", "cancelled", ""].map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1.5 text-sm font-light capitalize ${
              statusFilter === s
                ? "bg-cue-navy text-white"
                : "bg-cue-wash text-cue-muted hover:bg-cue-navy/10"
            }`}
          >
            {s || "all"}
          </button>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-2xl text-cue-navy">Bookings</h2>
        {bookings.length === 0 && (
          <p className="text-sm font-light text-cue-muted">No bookings in this filter.</p>
        )}
        {bookings.map((b) => (
          <div
            key={b.id}
            className="cue-card p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-bold text-cue-navy">
                  {new Date(b.startsAt).toLocaleString()} →{" "}
                  {new Date(b.endsAt).toLocaleString()}
                </div>
                <div className="text-sm font-medium text-cue-navy">
                  {b.spaceTitle || "Space"}
                  {b.locationName ? ` · ${b.locationName}` : ""}
                </div>
                <div className="text-sm font-light text-cue-muted">
                  {b.guestName || b.guestEmail || b.guestId} · {b.status} ·{" "}
                  {money(b.totalCents)}
                </div>
                <div className="mt-1 break-all text-xs font-light text-cue-muted/80">{b.id}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {b.status === "requested" && (
                  <>
                    <button
                      type="button"
                      onClick={() => act(`/api/v1/host/bookings/${b.id}/accept`)}
                      className="rounded-full bg-cue-green px-4 py-1.5 text-sm font-bold text-cue-navy"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => act(`/api/v1/host/bookings/${b.id}/decline`)}
                      className="btn-ghost !py-1.5 !px-4"
                    >
                      Decline
                    </button>
                  </>
                )}
                {["accepted", "in_progress", "completed"].includes(b.status) && (
                  <div className="flex items-center gap-2">
                    <select
                      value={overtimeMins}
                      onChange={(e) => setOvertimeMins(Number(e.target.value))}
                      className="cue-input !mt-0 !w-auto !py-1.5"
                    >
                      {[30, 60, 90, 120].map((m) => (
                        <option key={m} value={m}>
                          {m} min OT
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => chargeOt(b.id)}
                      className="rounded-full bg-cue-gold px-4 py-1.5 text-sm font-bold text-cue-ink"
                    >
                      Charge OT
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl text-cue-navy">Blockouts</h2>
        <form
          onSubmit={createBlockout}
          className="cue-card grid gap-3 p-5 md:grid-cols-5"
        >
          <label className="text-sm md:col-span-1">
            Space
            <select
              value={blockoutSpaceId}
              onChange={(e) => setBlockoutSpaceId(e.target.value)}
              className="cue-input"
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
            Starts
            <input
              type="datetime-local"
              required
              value={boStart}
              onChange={(e) => setBoStart(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="text-sm md:col-span-1">
            Ends
            <input
              type="datetime-local"
              required
              value={boEnd}
              onChange={(e) => setBoEnd(e.target.value)}
              className="cue-input"
            />
          </label>
          <label className="text-sm md:col-span-1">
            Reason
            <input
              value={boReason}
              onChange={(e) => setBoReason(e.target.value)}
              className="cue-input"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="btn-primary w-full"
            >
              Add blockout
            </button>
          </div>
        </form>
        {blockouts.map((x) => (
          <div
            key={x.id}
            className="cue-card flex items-center justify-between px-4 py-3 text-sm font-light"
          >
            <div>
              {new Date(x.startsAt).toLocaleString()} →{" "}
              {new Date(x.endsAt).toLocaleString()}
              {x.reason ? ` · ${x.reason}` : ""}
            </div>
            <button
              type="button"
              onClick={() => removeBlockout(x.id)}
              className="text-danger hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
