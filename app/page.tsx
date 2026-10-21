"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import type { LocationPublic, SpacePublic } from "@/lib/types";
import { Alert } from "@/components/ui/Alert";
import { capacityLabel, formatRate, roomCode } from "@/lib/format";
import { RequestToBookButton } from "@/components/RequestToBookButton";

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
              const lead = space.photos[0];
              return (
                <div
                  key={space.id}
                  data-testid={`room-card-${code.toLowerCase()}`}
                  className="cue-card cue-card-interactive flex flex-col overflow-hidden"
                >
                  {lead ? (
                    <Link href={`/spaces/${space.slug}`} tabIndex={-1} aria-hidden className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={lead.url}
                        alt=""
                        loading="lazy"
                        className="h-48 w-full bg-cue-stone-100 object-cover object-center"
                      />
                    </Link>
                  ) : null}
                  <div className="flex flex-1 flex-col gap-4 p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl">{space.title}</h3>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-cue-stone-500">
                          <Users aria-hidden className="h-4 w-4" />
                          {capacityLabel(space)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-lg font-semibold text-cue-navy-600">
                          {formatRate(space.pricing.baseHourlyCents)}
                        </div>
                        <div className="text-xs text-cue-stone-500">/hr</div>
                      </div>
                    </div>
                    <div className="mt-auto flex flex-wrap items-center gap-3">
                      <RequestToBookButton
                        href={`/spaces/${space.slug}#reserve`}
                        ariaLabel={`Request to book ${code}`}
                        testId={`request-to-book-${code.toLowerCase()}`}
                      />
                      <Link href={`/spaces/${space.slug}`} className="text-sm font-medium">
                        View {code}
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
