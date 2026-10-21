import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { CUE_M1, CUE_M2, CUE_M3, CUE_M4, IDS } from "../lib/seed";
import { createBookingRequest, createQuoteForSpace } from "../lib/bookings";
import { setEmailSender } from "../lib/email";
import { resetStore } from "../lib/store";
import { clearMock } from "../lib/google-calendar";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const GUEST = { name: "Hours Test", email: "hours@example.com" };

beforeEach(() => {
  resetStore();
  clearMock();
  setEmailSender({ send: async () => undefined });
});

describe("bookable hours Mon–Fri 8:00–18:00", () => {
  it("every room is bookable 08:00–18:00 on weekdays only", () => {
    for (const r of [CUE_M1, CUE_M2, CUE_M3, CUE_M4]) {
      expect(r.bookableHours.map((h) => [h.weekday, h.startMinute, h.endMinute])).toEqual(
        [1, 2, 3, 4, 5].map((d) => [d, 480, 1080])
      );
    }
  });

  // Wed 2027-01-06 (CST, UTC-6): 7:00 = 13:00Z, 8:00 = 14:00Z, 18:00 = 00:00Z next day.
  it("rejects a 7:00 start and a 18:30 end; accepts 8:00–18:00", async () => {
    const early = await createBookingRequest({ spaceId: IDS.m1, startsAt: "2027-01-06T13:00:00.000Z", endsAt: "2027-01-06T15:00:00.000Z", guest: GUEST, clientRequestKey: "h-early" });
    expect("booking" in early).toBe(false);
    expect((early as { message: string }).message).toContain("8:00am–6:00pm");
    const late = await createBookingRequest({ spaceId: IDS.m1, startsAt: "2027-01-06T22:00:00.000Z", endsAt: "2027-01-07T00:30:00.000Z", guest: GUEST, clientRequestKey: "h-late" });
    expect("booking" in late).toBe(false);
    const ok = await createBookingRequest({ spaceId: IDS.m1, startsAt: "2027-01-06T14:00:00.000Z", endsAt: "2027-01-07T00:00:00.000Z", guest: GUEST, clientRequestKey: "h-ok" });
    expect("booking" in ok).toBe(true);
  });

  it("multi-day full days are 10h each: Mon–Tue 8–18 = 20h with the 20% long-booking discount", async () => {
    // Mon 8:00–18:00 through Tue (endDate = an instant on Tue, CST).
    const q = await createQuoteForSpace(
      IDS.m1,
      new Date("2027-01-04T14:00:00.000Z"),
      new Date("2027-01-05T00:00:00.000Z"),
      undefined,
      new Date("2027-01-05T18:00:00.000Z")
    );
    if (!q.ok) throw new Error(q.message);
    expect(q.quote.hours).toBe(20);
    expect(q.quote.baseCents).toBe(20 * 7000);
    expect(q.quote.discountCents).toBe(Math.round(20 * 7000 * 0.2));
  });

  it("time dropdown is 08:00–18:00 and copy/openapi/README say 8:00–18:00", () => {
    const page = read("app/spaces/[slug]/page.tsx");
    expect(page).toContain("Array.from({ length: 21 }");
    expect(page).toContain("const minutes = 8 * 60 + i * 30;");
    expect(page).toContain("Mon–Fri 8:00am–6:00pm CT");
    expect(page).toContain("startTimeOptions.map");
    expect(page).not.toMatch(/7:00–18:00/);
    expect(read("openapi.yaml")).not.toMatch(/7:00–18:00/);
    expect(read("README.md")).toContain("8:00am–6:00pm");
    expect(read("migrations/018_bookable_hours_8_to_6.sql")).toContain("8 * 60, 18 * 60");
  });
});

describe("M2 Conference Room", () => {
  it("seed and migration rename M2; other rooms keep 'Meeting Room'", () => {
    expect(CUE_M2.title).toBe("M2 Conference Room");
    expect(CUE_M2.shortTitle).toBe("M2");
    expect(CUE_M1.title).toBe("M1 Meeting Room");
    expect(read("migrations/019_rename_m2_conference_room.sql")).toContain("title = 'M2 Conference Room'");
  });
});
