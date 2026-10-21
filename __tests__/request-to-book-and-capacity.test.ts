import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { capacityLabel } from "../lib/format";
import { CUE_M1, CUE_M2, CUE_M3, CUE_M4 } from "../lib/seed";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("room capacity", () => {
  it("M1 and M4 seat 8 with a max of 10; M2 and M3 unchanged", () => {
    for (const r of [CUE_M1, CUE_M4]) {
      expect(r.capacity).toBe(10);
      expect(r.seatedCapacity).toBe(8);
      expect(capacityLabel(r)).toBe("Seats 8 (max 10)");
      expect(r.subtitle).toBe("Seats 8 (max 10) · Cue Arts District");
    }
    expect(capacityLabel(CUE_M2)).toBe("20 seats");
    expect(capacityLabel(CUE_M3)).toBe("5 seats");
  });

  it("migration 017 sets seated_capacity 8 / capacity 10 for M1 and M4 only", () => {
    const sql = read("migrations/017_seated_capacity.sql");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS seated_capacity/);
    expect(sql).toMatch(/capacity = 10,\s+seated_capacity = 8/);
    expect(sql).toContain("c0000000-0000-4000-8000-000000000001");
    expect(sql).toContain("c0000000-0000-4000-8000-000000000004");
    expect(sql).not.toContain("c0000000-0000-4000-8000-000000000002");
    expect(sql).not.toContain("c0000000-0000-4000-8000-000000000003");
  });

  it("room page and home cards use the capacity label", () => {
    expect(read("app/spaces/[slug]/page.tsx")).toContain("{capacityLabel(space)}");
    expect(read("app/page.tsx")).toContain("{capacityLabel(space)}");
  });
});

describe("Request to book", () => {
  const room = read("app/spaces/[slug]/page.tsx");
  const btn = read("components/RequestToBookButton.tsx");
  it("is a copper link-button to #reserve that scrolls smoothly and focuses the first field", () => {
    expect(btn).toContain('buttonClasses("accent"');
    expect(btn).toContain('RESERVE_ANCHOR = "reserve"');
    expect(btn).toMatch(/scrollIntoView\(\{ behavior: .*"smooth"/);
    expect(btn).toContain("focus({ preventScroll: true })");
    expect(btn).toContain("prefers-reduced-motion");
  });
  it("room page: banner + about use it, form section is #reserve with sticky-header offset", () => {
    expect(room).toContain('testId="request-to-book-hero"');
    expect(room).toContain('testId="request-to-book-about"');
    expect(room).not.toContain('<Badge tone="navy">Request to book</Badge>');
    expect(room).toMatch(/id=\{RESERVE_ANCHOR\} className="[^"]*scroll-mt-\[74px\]/);
    expect(room).toContain("data-reserve-first-field");
  });
  it("home cards link to each room's #reserve", () => {
    expect(read("app/page.tsx")).toContain("href={`/spaces/${space.slug}#reserve`}");
  });
});
