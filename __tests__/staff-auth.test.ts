import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { hashPassword, verifyPassword } from "../lib/password";
import {
  STAFF_SESSION_COOKIE,
  buildSessionCookieValue,
  loginStaff,
  logoutStaffSession,
  requireStaff,
  upsertStaffUser,
} from "../lib/staff-auth";
import { resetStore } from "../lib/store";

beforeEach(() => {
  resetStore();
});

function requestWithCookie(cookieValue?: string): NextRequest {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `${STAFF_SESSION_COOKIE}=${cookieValue}`);
  return new NextRequest("http://localhost/api/v1/host/bookings", { headers });
}

describe("password hashing", () => {
  it("hashes to a non-plaintext scrypt-prefixed string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(hash).not.toContain("correct horse battery staple");
  });

  it("verifies the correct password and rejects an incorrect one", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(await verifyPassword("s3cret-password", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });
});

describe("staff login", () => {
  it("logs in with the right email/password and opens a session", async () => {
    await upsertStaffUser({ email: "Darcy@TheCue.Work", name: "D'Arcy", password: "flexible-rooms-1" });

    const result = await loginStaff("darcy@thecue.work", "flexible-rooms-1");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected successful login");
    expect(result.staff.email).toBe("darcy@thecue.work");
    expect(result.staff.name).toBe("D'Arcy");
    expect(result.token).toBeTruthy();
  });

  it("rejects an unknown email and a wrong password", async () => {
    await upsertStaffUser({ email: "staff@example.com", name: "Staff", password: "correct-password-1" });

    const noSuchUser = await loginStaff("nobody@example.com", "correct-password-1");
    expect(noSuchUser.ok).toBe(false);

    const wrongPassword = await loginStaff("staff@example.com", "wrong-password");
    expect(wrongPassword.ok).toBe(false);
  });
});

describe("requireStaff route protection", () => {
  it("rejects a request with no session cookie", async () => {
    const result = await requireStaff(requestWithCookie());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.status).toBe(401);
  });

  it("rejects a forged/garbage cookie value", async () => {
    const result = await requireStaff(requestWithCookie("not-a-real-token.not-a-real-signature"));
    expect(result.ok).toBe(false);
  });

  it("accepts a request carrying a valid session cookie from login", async () => {
    await upsertStaffUser({ email: "staff@example.com", name: "Staff", password: "correct-password-1" });
    const login = await loginStaff("staff@example.com", "correct-password-1");
    if (!login.ok) throw new Error("expected successful login");

    const cookieValue = buildSessionCookieValue(login.token);
    const result = await requireStaff(requestWithCookie(cookieValue));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.staff.email).toBe("staff@example.com");
  });

  it("rejects a session cookie after logout", async () => {
    await upsertStaffUser({ email: "staff@example.com", name: "Staff", password: "correct-password-1" });
    const login = await loginStaff("staff@example.com", "correct-password-1");
    if (!login.ok) throw new Error("expected successful login");
    const cookieValue = buildSessionCookieValue(login.token);

    expect((await requireStaff(requestWithCookie(cookieValue))).ok).toBe(true);

    await logoutStaffSession(cookieValue);

    expect((await requireStaff(requestWithCookie(cookieValue))).ok).toBe(false);
  });
});
