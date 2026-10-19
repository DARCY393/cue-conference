import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { JWT, OAuth2Client } from "google-auth-library";
import type { BusyInterval, SpacePublic } from "./types";

export type GoogleCalendarMode = "disabled" | "mock" | "live";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export const CALENDAR_UNAVAILABLE_MESSAGE =
  "Room calendar unavailable; try again or contact hello@thecue.work";

export type GoogleBusyResult =
  | { ok: true; busy: BusyInterval[] }
  | { ok: false; error: "calendar_unavailable"; message: string };

export interface GoogleEventResult {
  ok: boolean;
  eventId?: string;
  message?: string;
}

let loggedDisabledOnce = false;

function getMode(): GoogleCalendarMode {
  const raw = (process.env.GOOGLE_CALENDAR_MODE || "disabled") as GoogleCalendarMode;
  if (raw === "disabled" && !loggedDisabledOnce) {
    loggedDisabledOnce = true;
    console.log("Google Calendar sync disabled");
  }
  return raw;
}

function calendarIdsFor(space: SpacePublic): string[] {
  const ids = [space.googleCalendarId, ...(space.googleBusyCalendarIds ?? [])];
  return ids.filter((id): id is string => Boolean(id));
}

// ---------- Live auth ----------

let cachedAuthClient: JWT | OAuth2Client | null = null;

function buildAuthClient(): JWT | OAuth2Client {
  if (cachedAuthClient) return cachedAuthClient;

  const saJson = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
  const saFile = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_FILE;
  if (saJson || saFile) {
    const raw = saJson ? saJson : readFileSync(saFile!, "utf8");
    const creds = JSON.parse(raw) as { client_email: string; private_key: string };
    cachedAuthClient = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: SCOPES,
      subject: process.env.GOOGLE_CALENDAR_IMPERSONATE_SUBJECT || undefined,
    });
    return cachedAuthClient;
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const client = new OAuth2Client({ clientId, clientSecret });
    client.setCredentials({ refresh_token: refreshToken });
    cachedAuthClient = client;
    return cachedAuthClient;
  }

  throw new Error(
    "Google Calendar live mode requires GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON/_FILE or " +
      "GOOGLE_CALENDAR_CLIENT_ID/_SECRET/_REFRESH_TOKEN"
  );
}

async function getAccessToken(): Promise<string> {
  const client = buildAuthClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain Google Calendar access token");
  return token;
}

async function googleFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

// ---------- Mock mode ----------

interface MockInterval {
  startsAt: string;
  endsAt: string;
}

/** GOOGLE_CALENDAR_MOCK_BUSY accepts either {startsAt,endsAt} or {start,end} per interval. */
interface MockIntervalRaw {
  startsAt?: string;
  endsAt?: string;
  start?: string;
  end?: string;
}

interface MockEvent {
  id: string;
  calendarId: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: { cueBookingId: string } };
}

const mockBusyStore = new Map<string, MockInterval[]>();
const mockEvents = new Map<string, MockEvent>();
let mockBusySeeded = false;

function seedMockBusyFromEnv(): void {
  if (mockBusySeeded) return;
  mockBusySeeded = true;
  const raw = process.env.GOOGLE_CALENDAR_MOCK_BUSY;
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, MockIntervalRaw[]>;
    for (const [calendarId, intervals] of Object.entries(parsed)) {
      mockBusyStore.set(
        calendarId,
        intervals.map((i) => ({
          startsAt: i.startsAt ?? i.start!,
          endsAt: i.endsAt ?? i.end!,
        }))
      );
    }
  } catch (err) {
    console.error("[google-calendar] failed to parse GOOGLE_CALENDAR_MOCK_BUSY", err);
  }
}

export function setMockBusy(calendarId: string, intervals: MockInterval[]): void {
  mockBusyStore.set(calendarId, intervals);
}

export function clearMock(): void {
  mockBusyStore.clear();
  mockEvents.clear();
  mockBusySeeded = false;
}

export function getMockEvents(): MockEvent[] {
  return Array.from(mockEvents.values());
}

// ---------- Busy lookup ----------

function overlaps(aStart: string, aEnd: string, bStart: Date, bEnd: Date): boolean {
  return new Date(aStart) < bEnd && bStart < new Date(aEnd);
}

export async function getGoogleBusy(
  space: SpacePublic,
  from: Date,
  to: Date
): Promise<GoogleBusyResult> {
  const mode = getMode();
  if (mode === "disabled") return { ok: true, busy: [] };

  const calendarIds = calendarIdsFor(space);
  if (calendarIds.length === 0) return { ok: true, busy: [] };

  if (mode === "mock") {
    seedMockBusyFromEnv();
    const busy: BusyInterval[] = [];
    for (const id of calendarIds) {
      for (const interval of mockBusyStore.get(id) ?? []) {
        if (overlaps(interval.startsAt, interval.endsAt, from, to)) {
          busy.push({ startsAt: interval.startsAt, endsAt: interval.endsAt, kind: "google" });
        }
      }
    }
    return { ok: true, busy };
  }

  try {
    const res = await googleFetch("/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: calendarIds.map((id) => ({ id })),
      }),
    });
    if (!res.ok) {
      console.error(`[google-calendar] freebusy request failed with status ${res.status}`);
      return { ok: false, error: "calendar_unavailable", message: CALENDAR_UNAVAILABLE_MESSAGE };
    }
    const data = (await res.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }>;
    };
    const busy: BusyInterval[] = [];
    for (const id of calendarIds) {
      const cal = data.calendars?.[id];
      if (!cal || (cal.errors && cal.errors.length > 0)) {
        console.error(`[google-calendar] freebusy errors for calendar ${id}`, cal?.errors);
        return { ok: false, error: "calendar_unavailable", message: CALENDAR_UNAVAILABLE_MESSAGE };
      }
      for (const b of cal.busy ?? []) {
        busy.push({ startsAt: b.start, endsAt: b.end, kind: "google" });
      }
    }
    return { ok: true, busy };
  } catch (err) {
    console.error("[google-calendar] freebusy request threw", err);
    return { ok: false, error: "calendar_unavailable", message: CALENDAR_UNAVAILABLE_MESSAGE };
  }
}

// ---------- Event create/delete ----------

/**
 * Creates a single calendar event spanning `booking.startsAt`..`booking.endsAt`.
 * For a multi-day booking that span is first-day-start to last-day-end (see
 * expandDayWindows() in lib/availability.ts), so the event visually covers
 * the full range (including any skipped weekday gaps) rather than one event
 * per bookable day — a simplification accepted for this product.
 */
export async function createGoogleBookingEvent(
  space: SpacePublic,
  booking: { id: string; startsAt: string; endsAt: string; guestName?: string }
): Promise<GoogleEventResult> {
  const mode = getMode();
  if (mode === "disabled") return { ok: true };
  if (!space.googleCalendarId) return { ok: true };

  const body = {
    summary: `Cue booking — ${booking.guestName || "Guest"} (${space.shortTitle || space.title})`,
    description: `Booking ${booking.id}\nBooked via book.thecue.work`,
    start: { dateTime: booking.startsAt, timeZone: "America/Chicago" },
    end: { dateTime: booking.endsAt, timeZone: "America/Chicago" },
    extendedProperties: { private: { cueBookingId: booking.id } },
  };

  if (mode === "mock") {
    const eventId = `evt_mock_${randomUUID()}`;
    mockEvents.set(eventId, { id: eventId, calendarId: space.googleCalendarId, ...body });
    return { ok: true, eventId };
  }

  try {
    const res = await googleFetch(`/calendars/${encodeURIComponent(space.googleCalendarId)}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[google-calendar] create event failed with status ${res.status}: ${text}`);
      return { ok: false, message: "Failed to sync booking to Google Calendar" };
    }
    const data = (await res.json()) as { id: string };
    return { ok: true, eventId: data.id };
  } catch (err) {
    console.error("[google-calendar] create event threw", err);
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to sync booking to Google Calendar",
    };
  }
}

export async function deleteGoogleBookingEvent(
  space: SpacePublic | null | undefined,
  eventId: string | undefined
): Promise<void> {
  if (!eventId) return;
  const mode = getMode();
  if (mode === "disabled") return;

  if (mode === "mock") {
    mockEvents.delete(eventId);
    return;
  }

  if (!space?.googleCalendarId) return;
  try {
    const res = await googleFetch(
      `/calendars/${encodeURIComponent(space.googleCalendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" }
    );
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      console.error(`[google-calendar] delete event failed with status ${res.status}`);
    }
  } catch (err) {
    console.error("[google-calendar] delete event threw", err);
  }
}
