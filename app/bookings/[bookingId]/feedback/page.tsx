import type { Metadata } from "next";
import { getBookingById } from "@/lib/bookings";
import { verifyBookingAccessToken } from "@/lib/booking-access";
import { getFeedback, isRating } from "@/lib/feedback";
import { FeedbackForm } from "./FeedbackForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your feedback — Cue", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function FeedbackPage({ params, searchParams }: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ t?: string; r?: string }>;
}) {
  const { bookingId } = await params;
  const { t, r } = await searchParams;
  const valid = typeof t === "string" && verifyBookingAccessToken(bookingId, t);
  const b = valid ? await getBookingById(bookingId) : null;
  if (!valid || !b || b.status !== "completed" || new Date(b.endsAt) > new Date()) return <section className="mx-auto max-w-xl py-12"><h1 className="text-3xl">This feedback link isn&apos;t available</h1><p className="mt-4">Please use the link from your Cue email after your booking is completed.</p></section>;
  const initial = await getFeedback(bookingId);
  const value = Number(r);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" }).format(new Date(b.startsAt));
  return <section className="mx-auto max-w-xl space-y-6 py-8 sm:py-12">
    <p className="cue-eyebrow text-[#B5651D]">Your Cue experience</p>
    <h1 className="text-4xl text-[#213953]">How did we do?</h1>
    <p className="text-cue-stone-700">Thanks for choosing Cue. We&apos;d love to hear about your time in {b.spaceShortTitle || b.spaceTitle || "your conference room"} on {date}.</p>
    <div className="cue-card p-5 sm:p-7"><FeedbackForm bookingId={bookingId} token={t} initial={initial} clickedRating={isRating(value) ? value : null} /></div>
    <p className="text-sm text-cue-stone-500">Your feedback goes directly to our team and helps us make your next visit better.</p>
  </section>;
}
