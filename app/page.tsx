"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LocationPublic, SpacePublic } from "@/lib/types";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type Group = { location: LocationPublic; spaces: SpacePublic[] };

export default function Home() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/spaces?grouped=1")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).message || "Failed to load");
        return r.json();
      })
      .then((body) => setGroups(body.data ?? []))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-10">
      <section className="space-y-4 pt-4">
        <p className="text-sm font-light uppercase tracking-[0.12em] text-cue-muted">
          Conference booking
        </p>
        <h1 className="max-w-2xl text-4xl leading-tight text-cue-navy sm:text-5xl">
          Book a professional meeting room at Cue
        </h1>
        <p className="max-w-xl text-lg font-light text-cue-muted">
          Request-to-book conference space across Cue locations — flexible hours,
          parking add-ons, and host confirmation.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/host" className="btn-primary">
            Host inbox
          </Link>
        </div>
      </section>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-red-50 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {!error && groups.length === 0 && (
        <p className="font-light text-cue-muted">Loading locations…</p>
      )}

      {groups.map(({ location, spaces }) => (
        <section key={location.id} className="space-y-4">
          <div>
            <h2 className="text-2xl text-cue-navy">{location.name}</h2>
            <p className="text-sm font-light text-cue-muted">
              {location.city}
              {location.neighborhood ? ` · ${location.neighborhood}` : ""}
              {location.addressPublic ? ` · ${location.addressPublic}` : ""}
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {spaces.map((space) => (
              <Link
                key={space.id}
                href={`/spaces/${space.slug}`}
                className="cue-card group block overflow-hidden transition hover:border-cue-navy/25"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    space.photos[0]?.url ||
                    "https://images.unsplash.com/photo-1497366216548-37526070297c?w=800"
                  }
                  alt={space.photos[0]?.alt || space.title}
                  className="h-40 w-full object-cover"
                />
                <div className="space-y-2 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl text-cue-navy">{space.title}</h3>
                      <p className="text-sm font-light text-cue-muted">
                        {space.subtitle}
                      </p>
                    </div>
                    <div className="rounded-lg bg-cue-navy/5 px-2.5 py-1.5 text-right">
                      <div className="text-sm font-bold text-cue-navy">
                        {money(space.pricing.baseHourlyCents)}
                      </div>
                      <div className="text-[10px] font-light text-cue-navy-soft">
                        / hr
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="cue-chip">Capacity {space.capacity}</span>
                    <span className="cue-chip">Request to book</span>
                  </div>
                  <span className="inline-block pt-1 text-sm font-medium text-cue-navy group-hover:underline">
                    View & book →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
