import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/contact/route";
import { _resetContactRateLimiter } from "../lib/contact-rate-limit";
import { setEmailSender, type EmailMessage } from "../lib/email";

function postContact(body: unknown, ip = "203.0.113.1"): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/contact", () => {
  let sent: EmailMessage[];

  beforeEach(() => {
    _resetContactRateLimiter();
    sent = [];
    setEmailSender({
      async send(message: EmailMessage) {
        sent.push(message);
      },
    });
  });

  afterEach(() => {
    setEmailSender(null);
  });

  it("sends the message and replies ok:true for a valid submission", async () => {
    const res = await postContact({
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "Is M2 available Friday afternoon?",
      roomName: "M2 Conference Room",
      roomSlug: "arts-district-m2",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].replyTo).toBe("ada@example.com");
    expect(sent[0].text).toContain("Is M2 available Friday afternoon?");
  });

  it("rejects a missing field with 400", async () => {
    const res = await postContact({ name: "No Email", message: "hello" });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("rejects an invalid email with 400", async () => {
    const res = await postContact({ name: "Bad Email", email: "not-an-email", message: "hello" });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("rejects a name over 100 chars", async () => {
    const res = await postContact({
      name: "x".repeat(101),
      email: "a@example.com",
      message: "hello",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a message over 5000 chars", async () => {
    const res = await postContact({
      name: "Long",
      email: "a@example.com",
      message: "x".repeat(5001),
    });
    expect(res.status).toBe(400);
  });

  it("silently drops a submission with the honeypot filled, returning 200", async () => {
    const res = await postContact({
      name: "Bot",
      email: "bot@example.com",
      message: "spam",
      website: "http://spam.example.com",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("rate-limits after 5 requests from the same IP within the window", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 5; i++) {
      const res = await postContact(
        { name: "Guest", email: "guest@example.com", message: `msg ${i}` },
        ip
      );
      expect(res.status).toBe(200);
    }
    const sixth = await postContact(
      { name: "Guest", email: "guest@example.com", message: "msg 6" },
      ip
    );
    expect(sixth.status).toBe(429);
  });
});
