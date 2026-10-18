"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import type { LocationPublic, SpacePublic } from "@/lib/types";
import { buttonClasses } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function roomCode(space: SpacePublic): string {
  return space.shortTitle || space.slug.split("-").pop() || space.slug;
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
    <div className="space-y-12">
      <section className="space-y-4">
        <p className="cue-eyebrow">Conference booking</p>
        <h1 className="max-w-2xl text-[clamp(30px,3.2vw,42px)]">Book a meeting room at Cue</h1>
        <p className="max-w-xl text-lg text-cue-stone-700">
          Request a room below, add your details, and we&apos;ll hold the time. Host
          confirmation and a card hold finish the booking.
        </p>
      </section>

      {error && <Alert tone="danger">{error}</Alert>}

      {!error && groups.length === 0 && <p className="text-cue-stone-500">Loading locations…</p>}

      {groups.map(({ location, spaces }) => (
        <section key={location.id} className="space-y-5">
          <div>
            <h2 className="text-2xl">{location.name}</h2>
            <p className="text-sm text-cue-stone-500">
              {location.city}
              {location.neighborhood ? ` · ${location.neighborhood}` : ""}
              {location.addressPublic ? ` · ${location.addressPublic}` : ""}
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {spaces.map((space) => {
              const code = roomCode(space);
              return (
                <div
                  key={space.id}
                  data-testid={`room-card-${code.toLowerCase()}`}
                  className="cue-card cue-card-interactive flex flex-col gap-4 p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl">{space.title}</h3>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-cue-stone-500">
                        <Users aria-hidden className="h-4 w-4" />
                        {space.capacity} seats
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-lg font-semibold text-cue-navy-600">
                        {money(space.pricing.baseHourlyCents)}
                      </div>
                      <div className="text-xs text-cue-stone-500">/ hr</div>
                    </div>
                  </div>
                  <p className="text-sm text-cue-stone-700">{space.subtitle}</p>
                  <Link
                    href={`/spaces/${space.slug}`}
                    className={buttonClasses("secondary", "mt-auto self-start")}
                  >
                    Book {code}
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
