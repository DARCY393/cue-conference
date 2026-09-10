"use client";

import { useCallback, useEffect, useState } from "react";
import type { Booking, Blockout } from "@/lib/types";
import { IDS } from "@/lib/seed";

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

  const headers = useCallback(
    () => ({
      Authorization: `Bearer ${hostEmail}`,
      "Content-Type": "application/json",
    }),
    [hostEmail]
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = statusFilter ? `?status=${statusFilter}` : "";
      const [bRes, xRes] = await Promise.all([
        fetch(`/api/v1/host/bookings${q}`, { headers: headers() }),
        fetch(`/api/v1/host/blockouts?spaceId=${IDS.space}`, {
          headers: headers(),
        }),
      ]);
      const bData = await bRes.json();
      const xData = await xRes.json();
      if (!bRes.ok) throw new Error(bData.message || "Failed to load bookings");
      if (!xRes.ok) throw new Error(xData.message || "Failed to load blockouts");
      setBookings(bData.data);
      setBlockouts(xData.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [headers, statusFilter]);

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
        spaceId: IDS.space,
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
          <h1 className="text-2xl font-semibold">Host queue</h1>
          <p className="text-sm text-slate-500">
            Authenticate with <code className="rounded bg-slate-100 px-1">HOST_EMAIL</code>{" "}
            bearer token (default host@example.com).
          </p>
        </div>
        <label className="text-sm">
          Host email
          <input
            value={hostEmail}
            onChange={(e) => setHostEmail(e.target.value)}
            className="ml-2 rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {["requested", "accepted", "declined", "cancelled", ""].map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-sm ${
              statusFilter === s
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {s || "all"}
          </button>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Bookings</h2>
        {bookings.length === 0 && (
          <p className="text-sm text-slate-500">No bookings in this filter.</p>
        )}
        {bookings.map((b) => (
          <div
            key={b.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-slate-900">
                  {new Date(b.startsAt).toLocaleString()} →{" "}
                  {new Date(b.endsAt).toLocaleString()}
                </div>
                <div className="text-sm text-slate-500">
                  {b.guestName || b.guestEmail || b.guestId} · {b.status} ·{" "}
                  {money(b.totalCents)}
                </div>
                <div className="mt-1 break-all text-xs text-slate-400">{b.id}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {b.status === "requested" && (
                  <>
                    <button
                      type="button"
                      onClick={() => act(`/api/v1/host/bookings/${b.id}/accept`)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => act(`/api/v1/host/bookings/${b.id}/decline`)}
                      className="rounded-lg bg-slate-200 px-3 py-1.5 text-sm text-slate-800"
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
                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
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
                      className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm text-white"
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
        <h2 className="text-lg font-medium">Blockouts</h2>
        <form
          onSubmit={createBlockout}
          className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4"
        >
          <label className="text-sm md:col-span-1">
            Starts
            <input
              type="datetime-local"
              required
              value={boStart}
              onChange={(e) => setBoStart(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-sm md:col-span-1">
            Ends
            <input
              type="datetime-local"
              required
              value={boEnd}
              onChange={(e) => setBoEnd(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-sm md:col-span-1">
            Reason
            <input
              value={boReason}
              onChange={(e) => setBoReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white"
            >
              Add blockout
            </button>
          </div>
        </form>
        {blockouts.map((x) => (
          <div
            key={x.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
          >
            <div>
              {new Date(x.startsAt).toLocaleString()} →{" "}
              {new Date(x.endsAt).toLocaleString()}
              {x.reason ? ` · ${x.reason}` : ""}
            </div>
            <button
              type="button"
              onClick={() => removeBlockout(x.id)}
              className="text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
