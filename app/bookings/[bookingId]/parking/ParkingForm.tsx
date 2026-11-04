"use client";

import { useState } from "react";

export function ParkingForm({
  bookingId,
  token,
  passes,
  initial,
}: {
  bookingId: string;
  token: string;
  passes: number;
  initial: { phone?: string; email?: string }[];
}) {
  const [rows, setRows] = useState<string[]>(() =>
    Array.from({ length: passes }, (_, i) => initial[i]?.phone || initial[i]?.email || "")
  );
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  function update(i: number, value: string) {
    setRows((prev) => prev.map((r, j) => (j === i ? value : r)));
    if (state !== "saving") setState("idle");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setMessage("");
    try {
      const res = await fetch(`/api/v1/bookings/${encodeURIComponent(bookingId)}/parking-recipients`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, recipients: rows.map((contact) => ({ contact })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(data?.message || data?.error?.message || "Something went wrong. Please try again.");
        return;
      }
      setState("saved");
      setMessage("Thanks, we've got your list. You can come back and change it until your booking starts.");
    } catch {
      setState("error");
      setMessage("Couldn't reach the server. Please try again.");
    }
  }

  const input =
    "mt-1 w-full rounded-tile border border-cue-stone-300 bg-white px-3 py-2 text-sm text-cue-ink focus:border-cue-navy-600 focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="parking-form">
      {rows.map((value, i) => (
        <label key={i} className="block text-sm font-semibold text-cue-navy-600">
          Pass {i + 1}: mobile number or email
          <input
            className={input}
            type="text"
            inputMode="email"
            placeholder="214-555-0123 or name@company.com"
            value={value}
            onChange={(e) => update(i, e.target.value)}
            autoComplete="off"
            data-testid={`parking-contact-${i + 1}`}
          />
        </label>
      ))}
      <p className="text-xs text-cue-stone-500">Leave a pass blank if you don&apos;t need it.</p>
      <button type="submit" disabled={state === "saving"} className="btn btn-accent">
        {state === "saving" ? "Saving…" : initial.length ? "Update list" : "Send list"}
      </button>
      {message && (
        <p
          role="status"
          data-testid="parking-form-message"
          className={`text-sm ${state === "error" ? "text-cue-red-600" : "text-cue-navy-600"}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
