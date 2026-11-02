import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/v1/inquiries/route";
import { _resetInquiries, listInquiries } from "../lib/inquiries";
import { setEmailSender, type EmailMessage } from "../lib/email";
import {
  contentVerdict,
  countLinks,
  formTokenAgeMs,
  issueFormToken,
  localVerdict,
  verifyTurnstile,
} from "../lib/inquiry-spam";

const OLD_TOKEN = () => issueFormToken(Date.now() - 10_000);

function post(body: Record<string, unknown>, ip = "203.0.113.9"): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/v1/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify(body),
    })
  );
}

const valid = (over: Record<string, unknown> = {}) => ({
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "214-555-0100",
  roomSlug: "arts-district-m2",
  preferredDate: "2026-11-20",
  message: "Does M2 have a screen we can plug a laptop into?",
  formToken: OLD_TOKEN(),
  ...over,
});

describe("inquiry spam checks", () => {
  it("token: valid age, forged and missing", () => {
    const t = issueFormToken(1_000_000_000_000);
    expect(formTokenAgeMs(t, 1_000_000_005_000)).toBe(5000);
    expect(formTokenAgeMs(t.replace(/.$/, (c) => (c === "a" ? "b" : "a")), 1_000_000_005_000)).toBeNull();
    expect(formTokenAgeMs("1000000000000.deadbeef")).toBeNull();
    expect(formTokenAgeMs(undefined)).toBeNull();
  });

  it("verdicts: honeypot, too fast, bad token, ok", () => {
    expect(localVerdict({ honeypot: "x", formToken: OLD_TOKEN(), text: "hi" })).toBe("honeypot");
    expect(localVerdict({ formToken: issueFormToken(), text: "hi" })).toBe("too_fast");
    expect(localVerdict({ formToken: "nope", text: "hi" })).toBe("bad_token");
    expect(localVerdict({ formToken: issueFormToken(Date.now() - 2 * 86_400_000), text: "hi" })).toBe("bad_token");
    expect(localVerdict({ formToken: OLD_TOKEN(), text: "hi" })).toBe("ok");
  });

  it("links: counts URLs but not email addresses", () => {
    expect(countLinks("see https://a.com and www.b.org and c.net")).toBe(3);
    expect(countLinks("email me at jo@acme.com")).toBe(0);
    expect(contentVerdict("https://a.com https://b.com")).toBe("ok");
    expect(contentVerdict("https://a.com https://b.com https://c.com")).toBe("too_many_links");
  });

  it("shorteners and keywords", () => {
    expect(contentVerdict("check bit.ly/abc")).toBe("shortener");
    expect(contentVerdict("We offer SEO backlinks for your site")).toBe("keywords");
    expect(contentVerdict("Can we bring our own coffee to M3?")).toBe("ok");
  });

  it("turnstile: skipped when unconfigured, fails with no token when configured", async () => {
    expect(await verifyTurnstile(undefined, "1.2.3.4")).toBe(true);
    vi.stubEnv("TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    expect(await verifyTurnstile("", "1.2.3.4")).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("/api/v1/inquiries", () => {
  let sent: EmailMessage[];
  beforeEach(() => {
    _resetInquiries();
    sent = [];
    vi.stubEnv("HOST_EMAIL", "spp@thecue.work,darcy@thecue.work");
    setEmailSender({ async send(m: EmailMessage) { sent.push(m); } });
  });
  afterEach(() => {
    setEmailSender(null);
    vi.unstubAllEnvs();
  });

  it("GET issues a form token and no Turnstile key when unconfigured", async () => {
    const d = await (await GET()).json();
    expect(formTokenAgeMs(d.formToken)).not.toBeNull();
    expect(d.turnstileSiteKey).toBeNull();
  });

  it("valid question: emails host list with Reply-To + acknowledges the asker, stores it", async () => {
    const res = await post(valid());
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(2);
    const [host, ack] = sent;
    expect(host.to).toBe("spp@thecue.work,darcy@thecue.work");
    expect(host.replyTo).toBe("ada@example.com");
    expect(host.template).toBe("host_inquiry");
    expect(host.subject).toMatch(/^Question about .*M2.* — Ada Lovelace$/);
    expect(host.text).toContain("214-555-0100");
    expect(host.text).toContain("Does M2 have a screen");
    expect(ack.to).toBe("ada@example.com");
    expect(ack.template).toBe("inquiry_ack");
    expect(ack.text).toContain("usually within a business day");
    const rows = await listInquiries();
    expect(rows).toHaveLength(1);
    expect(rows[0].spamVerdict).toBe("ok");
    expect(rows[0].ipHash).not.toContain("203.0.113.9");
  });

  it("preview prefix applies to the host subject", async () => {
    vi.stubEnv("CUE_APP_ENV", "preview");
    const seen: EmailMessage[] = [];
    // getEmailSender wraps the override, so the override sees the prefixed subject
    setEmailSender({ async send(m: EmailMessage) { seen.push(m); } });
    await post(valid());
    expect(seen[0].subject.startsWith("[PREVIEW] Question about")).toBe(true);
  });

  it("rejects missing fields / bad email / long message with 400", async () => {
    expect((await post(valid({ email: "" }))).status).toBe(400);
    expect((await post(valid({ email: "nope" }))).status).toBe(400);
    expect((await post(valid({ message: "x".repeat(2001) }))).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["honeypot", () => ({ website: "http://x.example" })],
    ["too_fast", () => ({ formToken: issueFormToken() })],
    ["bad_token", () => ({ formToken: undefined })],
    ["too_many_links", () => ({ message: "https://a.com https://b.com https://c.com" })],
  ])("%s: fake success, nothing sent, stored as spam", async (verdict, over) => {
    const res = await post(valid(over()));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(sent).toHaveLength(0);
    const rows = await listInquiries();
    expect(rows[0].spamVerdict).toBe(verdict);
  });

  it("rate limits per IP at 3/hour", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await post(valid({ email: `p${i}@example.com` }), "198.51.100.1")).status).toBe(200);
    }
    expect((await post(valid({ email: "p9@example.com" }), "198.51.100.1")).status).toBe(429);
    expect(sent).toHaveLength(6);
  });

  it("rate limits per email across IPs at 3/hour", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await post(valid(), `198.51.100.${10 + i}`)).status).toBe(200);
    }
    expect((await post(valid({ email: "ADA@example.com" }), "198.51.100.99")).status).toBe(429);
  });
});
