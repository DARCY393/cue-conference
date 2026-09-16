import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-4 pt-4">
        <p className="text-sm font-light uppercase tracking-[0.12em] text-cue-muted">
          Conference booking
        </p>
        <h1 className="max-w-2xl text-4xl leading-tight text-cue-navy sm:text-5xl">
          Book a professional meeting room at Cue Dallas
        </h1>
        <p className="max-w-xl text-lg font-light text-cue-muted">
          Request-to-book conference space with flexible hours, parking add-ons,
          and host confirmation — styled for the Cue coworking brand.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/spaces/cue-dallas" className="btn-accent">
            Book a room
          </Link>
          <Link href="/host" className="btn-primary">
            Host inbox
          </Link>
        </div>
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <Link
          href="/spaces/cue-dallas"
          className="cue-card group block space-y-3 p-6 transition hover:border-cue-navy/25"
        >
          <h2 className="text-xl text-cue-navy">Guest booking</h2>
          <p className="font-light text-cue-muted">
            Pick a date and time, get a live quote, and authorize payment. Host
            accept captures the hold.
          </p>
          <span className="inline-block text-sm font-medium text-cue-navy group-hover:underline">
            Open Cue Dallas →
          </span>
        </Link>
        <Link
          href="/host"
          className="cue-card group block space-y-3 p-6 transition hover:border-cue-navy/25"
        >
          <h2 className="text-xl text-cue-navy">Host queue</h2>
          <p className="font-light text-cue-muted">
            Review requests, accept or decline, manage blockouts, and charge
            overtime when needed.
          </p>
          <span className="inline-block text-sm font-medium text-cue-navy group-hover:underline">
            Open host inbox →
          </span>
        </Link>
      </section>
    </div>
  );
}
