import { randomUUID } from "crypto";
import { CUE_SPACE, HOST_EMAIL_DEFAULT, IDS } from "./seed";
import type { Booking, Blockout, BusyInterval, SpacePublic } from "./types";

/** Process-wide in-memory demo store (used when DATABASE_URL is absent). */
class MemoryStore {
  space: SpacePublic = structuredClone(CUE_SPACE);
  hostEmail = process.env.HOST_EMAIL || HOST_EMAIL_DEFAULT;
  bookings: Booking[] = [];
  blockouts: Blockout[] = [];
  guests = new Map<string, { id: string; name: string; email: string; phone?: string }>();
  paymentEvents: {
    id: string;
    bookingId: string;
    type: string;
    amountCents: number;
    stripeObjectId?: string;
    idempotencyKey?: string;
  }[] = [];

  getSpaceBySlug(slug: string): SpacePublic | null {
    if (this.space.slug === slug && this.space.status !== "draft") {
      return this.toPublic(this.space);
    }
    return null;
  }

  /** Full space including private fields (internal). */
  getSpaceById(id: string): SpacePublic | null {
    if (this.space.id === id) return structuredClone(this.space);
    return null;
  }

  toPublic(space: SpacePublic): SpacePublic {
    const copy = structuredClone(space);
    delete copy.addressPrivate;
    delete copy.hostId;
    delete copy.cancellationPolicyId;
    return copy;
  }

  getBusy(spaceId: string): BusyInterval[] {
    const fromBookings = this.bookings
      .filter(
        (b) =>
          b.spaceId === spaceId &&
          ["requested", "accepted", "in_progress"].includes(b.status)
      )
      .map((b) => ({
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        kind: "booking" as const,
        id: b.id,
      }));
    const fromBlockouts = this.blockouts
      .filter((x) => x.spaceId === spaceId)
      .map((x) => ({
        startsAt: x.startsAt,
        endsAt: x.endsAt,
        kind: "blockout" as const,
        id: x.id,
      }));
    return [...fromBookings, ...fromBlockouts];
  }

  upsertGuest(name: string, email: string, phone?: string) {
    const key = email.toLowerCase();
    const existing = this.guests.get(key);
    if (existing) {
      existing.name = name;
      if (phone) existing.phone = phone;
      return existing;
    }
    const g = { id: randomUUID(), name, email, phone };
    this.guests.set(key, g);
    return g;
  }

  createBooking(booking: Booking): Booking {
    this.bookings.push(booking);
    return booking;
  }

  getBooking(id: string): Booking | undefined {
    return this.bookings.find((b) => b.id === id);
  }

  updateBooking(id: string, patch: Partial<Booking>): Booking | undefined {
    const b = this.getBooking(id);
    if (!b) return undefined;
    Object.assign(b, patch);
    return b;
  }

  listHostBookings(opts: {
    status?: string;
    from?: string;
    to?: string;
  }): Booking[] {
    return this.bookings.filter((b) => {
      if (b.spaceId !== IDS.space) return false;
      if (opts.status && b.status !== opts.status) return false;
      if (opts.from && b.endsAt <= opts.from) return false;
      if (opts.to && b.startsAt >= opts.to) return false;
      return true;
    });
  }

  createBlockout(bo: Blockout): Blockout {
    const conflict = this.blockouts.some(
      (x) =>
        x.spaceId === bo.spaceId &&
        new Date(bo.startsAt) < new Date(x.endsAt) &&
        new Date(x.startsAt) < new Date(bo.endsAt)
    );
    if (conflict) {
      const err = new Error("Overlaps another blockout") as Error & {
        code: string;
      };
      err.code = "conflict";
      throw err;
    }
    this.blockouts.push(bo);
    return bo;
  }

  listBlockouts(spaceId: string, from?: string, to?: string): Blockout[] {
    return this.blockouts.filter((x) => {
      if (x.spaceId !== spaceId) return false;
      if (from && x.endsAt <= from) return false;
      if (to && x.startsAt >= to) return false;
      return true;
    });
  }

  deleteBlockout(id: string): boolean {
    const i = this.blockouts.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.blockouts.splice(i, 1);
    return true;
  }
}

const globalForStore = globalThis as unknown as { __cueStore?: MemoryStore };

export function getStore(): MemoryStore {
  if (!globalForStore.__cueStore) {
    globalForStore.__cueStore = new MemoryStore();
  }
  return globalForStore.__cueStore;
}

export function isDemoMode(): boolean {
  return !process.env.DATABASE_URL;
}
