import { randomUUID } from "crypto";
import { CUE_SPACES, HOST_EMAIL_DEFAULT, IDS, resolveLegacySpaceSlug } from "./seed";
import type { Booking, Blockout, BusyInterval, SpacePublic } from "./types";
import { toPublicSpaceJson } from "./space-public";

export interface StaffUserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface StaffSessionRecord {
  id: string;
  staffUserId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

/** Process-wide in-memory demo store (used when DATABASE_URL is absent). */
class MemoryStore {
  spaces: SpacePublic[] = CUE_SPACES.map((s) => structuredClone(s));
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
  staffUsers: StaffUserRecord[] = [];
  staffSessions: StaffSessionRecord[] = [];

  /** @deprecated use spaces[0] — kept for older call sites */
  get space(): SpacePublic {
    return this.spaces[0];
  }

  listSpaces(): SpacePublic[] {
    return this.spaces
      .filter((s) => s.status === "live")
      .map((s) => this.toPublic(s));
  }

  getSpaceBySlug(slug: string): SpacePublic | null {
    const canonical = resolveLegacySpaceSlug(slug);
    const space = this.spaces.find(
      (s) => (s.slug === slug || s.slug === canonical) && s.status !== "draft"
    );
    return space ? this.toPublic(space) : null;
  }

  /** Full space including private fields (internal). */
  getSpaceById(id: string): SpacePublic | null {
    const space = this.spaces.find((s) => s.id === id);
    return space ? structuredClone(space) : null;
  }

  toPublic(space: SpacePublic): SpacePublic {
    return toPublicSpaceJson(space);
  }

  hostSpaceIds(): Set<string> {
    return new Set(this.spaces.map((s) => s.id));
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
    const space = this.getSpaceById(booking.spaceId);
    if (space) {
      booking.spaceTitle = space.title;
      booking.locationName = space.location?.name;
      booking.spaceSlug = space.slug;
    }
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
    const ids = this.hostSpaceIds();
    return this.bookings.filter((b) => {
      if (!ids.has(b.spaceId)) return false;
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

  /** Upserts one staff account by lowercased email. Used only by the `staff:create` CLI. */
  upsertStaffUser(input: {
    email: string;
    name: string;
    passwordHash: string;
    role?: string;
  }): StaffUserRecord {
    const email = input.email.toLowerCase();
    const existing = this.staffUsers.find((u) => u.email === email);
    if (existing) {
      existing.name = input.name;
      existing.passwordHash = input.passwordHash;
      if (input.role) existing.role = input.role;
      existing.active = true;
      return existing;
    }
    const user: StaffUserRecord = {
      id: randomUUID(),
      email,
      name: input.name,
      passwordHash: input.passwordHash,
      role: input.role || "admin",
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.staffUsers.push(user);
    return user;
  }

  findStaffUserByEmail(email: string): StaffUserRecord | undefined {
    return this.staffUsers.find((u) => u.email === email.toLowerCase());
  }

  findStaffUserById(id: string): StaffUserRecord | undefined {
    return this.staffUsers.find((u) => u.id === id);
  }

  touchStaffLogin(id: string): void {
    const user = this.findStaffUserById(id);
    if (user) user.lastLoginAt = new Date().toISOString();
  }

  createStaffSession(session: StaffSessionRecord): StaffSessionRecord {
    this.staffSessions.push(session);
    return session;
  }

  findStaffSessionByTokenHash(tokenHash: string): StaffSessionRecord | undefined {
    return this.staffSessions.find((s) => s.tokenHash === tokenHash);
  }

  deleteStaffSessionByTokenHash(tokenHash: string): void {
    const i = this.staffSessions.findIndex((s) => s.tokenHash === tokenHash);
    if (i >= 0) this.staffSessions.splice(i, 1);
  }
}

const globalForStore = globalThis as unknown as { __cueStore?: MemoryStore };

export function getStore(): MemoryStore {
  if (!globalForStore.__cueStore) {
    globalForStore.__cueStore = new MemoryStore();
  }
  return globalForStore.__cueStore;
}

/** Test helper: discard all in-memory bookings/blockouts/guests and reseed spaces. */
export function resetStore(): void {
  globalForStore.__cueStore = new MemoryStore();
}

export function isDemoMode(): boolean {
  return !process.env.DATABASE_URL;
}

export { IDS };
