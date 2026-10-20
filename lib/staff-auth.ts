import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { query } from "./db";
import { getStore, isDemoMode } from "./store";
import { hashPassword, verifyPassword } from "./password";
import type { StaffUser } from "./types";

export const STAFF_SESSION_COOKIE = "cue_staff_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export type { StaffUser };

type AuthFailure = { ok: false; status: number; error: string; message: string };

/**
 * HMAC key for signing the session cookie. Required in production so a restart doesn't
 * silently accept old/forged cookies; falls back to a per-process random key outside
 * production so local dev and tests don't need a .env entry.
 */
function sessionSecret(): string {
  const configured = (process.env.SESSION_SECRET || "").trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production");
  }
  const g = globalThis as unknown as { __cueDevSessionSecret?: string };
  if (!g.__cueDevSessionSecret) g.__cueDevSessionSecret = randomBytes(32).toString("hex");
  return g.__cueDevSessionSecret;
}

function sign(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function timingSafeStringsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Cookie value is `<token>.<hmac(token)>`; the signature is checked before any session lookup. */
export function buildSessionCookieValue(token: string): string {
  return `${token}.${sign(token)}`;
}

function parseSessionCookieValue(value: string | undefined | null): string | null {
  if (!value) return null;
  const idx = value.lastIndexOf(".");
  if (idx < 0) return null;
  const token = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!timingSafeStringsEqual(sig, sign(token))) return null;
  return token;
}

export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

function toStaffUser(row: {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
}): StaffUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, active: row.active };
}

/** Upserts one staff account by lowercased email. Only called from the local `staff:create` CLI. */
export async function upsertStaffUser(input: {
  email: string;
  name: string;
  password: string;
  role?: string;
}): Promise<StaffUser> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  if (isDemoMode()) {
    const rec = getStore().upsertStaffUser({
      email,
      name: input.name,
      passwordHash,
      role: input.role,
    });
    return toStaffUser(rec);
  }
  const { rows } = await query<{
    id: string;
    email: string;
    name: string;
    role: string;
    active: boolean;
  }>(
    `INSERT INTO staff_users (email, name, password_hash, role, active)
     VALUES ($1, $2, $3, COALESCE($4, 'admin'), true)
     ON CONFLICT (lower(email)) DO UPDATE
       SET name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role = COALESCE($4, staff_users.role),
           active = true
     RETURNING id, email, name, role, active`,
    [email, input.name, passwordHash, input.role || null]
  );
  return toStaffUser(rows[0]);
}

async function findStaffRowByEmail(email: string): Promise<
  (StaffUser & { passwordHash: string }) | null
> {
  const lower = email.trim().toLowerCase();
  if (isDemoMode()) {
    const rec = getStore().findStaffUserByEmail(lower);
    return rec ? { ...toStaffUser(rec), passwordHash: rec.passwordHash } : null;
  }
  const { rows } = await query<{
    id: string;
    email: string;
    name: string;
    role: string;
    active: boolean;
    password_hash: string;
  }>(
    `SELECT id, email, name, role, active, password_hash FROM staff_users WHERE lower(email) = $1`,
    [lower]
  );
  const row = rows[0];
  return row ? { ...toStaffUser(row), passwordHash: row.password_hash } : null;
}

async function touchLastLogin(staffUserId: string): Promise<void> {
  if (isDemoMode()) {
    getStore().touchStaffLogin(staffUserId);
    return;
  }
  await query(`UPDATE staff_users SET last_login_at = now() WHERE id = $1`, [staffUserId]);
}

async function createSession(staffUserId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  if (isDemoMode()) {
    getStore().createStaffSession({
      id: randomBytes(16).toString("hex"),
      staffUserId,
      tokenHash: hash,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  } else {
    await query(
      `INSERT INTO staff_sessions (staff_user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [staffUserId, hash, expiresAt.toISOString()]
    );
  }
  return { token, expiresAt };
}

export type LoginResult = { ok: true; staff: StaffUser; token: string } | AuthFailure;

/** Verifies email + password and, on success, opens a new session. Returns the raw token to set as a cookie. */
export async function loginStaff(email: string, password: string): Promise<LoginResult> {
  const invalid: AuthFailure = {
    ok: false,
    status: 401,
    error: "invalid_credentials",
    message: "Incorrect email or password.",
  };
  const row = await findStaffRowByEmail(email);
  if (!row || !row.active) return invalid;
  const valid = await verifyPassword(password, row.passwordHash);
  if (!valid) return invalid;
  const { token } = await createSession(row.id);
  await touchLastLogin(row.id);
  return { ok: true, staff: toStaffUser(row), token };
}

export async function logoutStaffSession(cookieValue: string | undefined | null): Promise<void> {
  const token = parseSessionCookieValue(cookieValue);
  if (!token) return;
  const hash = tokenHash(token);
  if (isDemoMode()) {
    getStore().deleteStaffSessionByTokenHash(hash);
    return;
  }
  await query(`DELETE FROM staff_sessions WHERE token_hash = $1`, [hash]);
}

async function findSessionStaff(token: string): Promise<StaffUser | null> {
  const hash = tokenHash(token);
  if (isDemoMode()) {
    const session = getStore().findStaffSessionByTokenHash(hash);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) return null;
    const user = getStore().findStaffUserById(session.staffUserId);
    if (!user || !user.active) return null;
    return toStaffUser(user);
  }
  const { rows } = await query<{
    id: string;
    email: string;
    name: string;
    role: string;
    active: boolean;
  }>(
    `SELECT u.id, u.email, u.name, u.role, u.active
     FROM staff_sessions s
     JOIN staff_users u ON u.id = s.staff_user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND s.revoked_at IS NULL`,
    [hash]
  );
  const row = rows[0];
  return row && row.active ? toStaffUser(row) : null;
}

/** Session-cookie gate for /api/v1/host/* and the staff pages — replaces the old HOST_EMAIL bearer gate. */
export async function requireStaff(
  req: NextRequest
): Promise<{ ok: true; staff: StaffUser } | AuthFailure> {
  const unauthorized: AuthFailure = {
    ok: false,
    status: 401,
    error: "unauthorized",
    message: "Staff sign-in required.",
  };
  const token = parseSessionCookieValue(req.cookies.get(STAFF_SESSION_COOKIE)?.value);
  if (!token) return unauthorized;
  const staff = await findSessionStaff(token);
  if (!staff) return unauthorized;
  return { ok: true, staff };
}
