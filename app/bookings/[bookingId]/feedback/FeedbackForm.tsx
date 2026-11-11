"use client";

import { useEffect, useState } from "react";
import type { Feedback, Rating } from "@/lib/feedback";

export function FeedbackForm({ bookingId, token, initial, clickedRating }: { bookingId: string; token: string; initial: Feedback | null; clickedRating: Rating | null }) {
  const [rating, setRating] = useState<Rating | null>(clickedRating || initial?.rating || null);
  const [comment, setComment] = useState(initial?.comment || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!clickedRating) return;
    let active = true;
    fetch(`/api/v1/bookings/${encodeURIComponent(bookingId)}/feedback`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, rating: clickedRating }),
    }).then((res) => { if (active) setMessage(res.ok ? "Thanks — your rating is saved. Add a comment below if you'd like." : "Your rating wasn't saved. Please try Submit below."); })
      .catch(() => { if (active) setMessage("Your rating wasn't saved. Please try Submit below."); });
    return () => { active = false; };
  }, [bookingId, token, clickedRating]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) { setMessage("Choose a rating from 1 to 5."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/bookings/${encodeURIComponent(bookingId)}/feedback`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, rating, comment, submit: true }),
      });
      const data = await res.json();
      setMessage(res.ok ? "Thank you for your feedback. We hope to see you again soon. You can return here to update it." : data?.error?.message || "We couldn't save your feedback. Please try again.");
    } catch { setMessage("Couldn't reach the server. Please try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-6" data-testid="feedback-form">
    <fieldset disabled={busy}><legend className="mb-3 font-semibold text-cue-navy-600">How would you rate your experience?</legend>
      <div className="flex gap-3">{([1,2,3,4,5] satisfies Rating[]).map((n) => <label key={n} className={`cursor-pointer rounded-control border px-4 py-3 text-lg ${rating === n ? "border-[#213953] bg-[#213953] text-white" : "border-cue-stone-300 bg-white text-cue-navy-600"}`}>
        <input className="sr-only peer" type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} out of 5`} />
        <span className="peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#B5651D]">{n}</span>
      </label>)}</div><p className="mt-2 text-sm text-cue-stone-500">1 — Poor · 5 — Excellent</p>
    </fieldset>
    <label className="block font-semibold text-cue-navy-600">Anything else you&apos;d like us to know? <span className="font-normal">(optional)</span>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} rows={4} disabled={busy} className="mt-2 block w-full rounded-control border border-cue-stone-300 p-3 text-base font-normal text-cue-ink focus:outline-[#B5651D]" />
    </label>
    <button className="btn btn-accent" type="submit" disabled={busy}>{busy ? "Saving…" : "Submit feedback"}</button>
    {message && <p role="status" className="text-sm text-cue-navy-600">{message}</p>}
  </form>;
}
