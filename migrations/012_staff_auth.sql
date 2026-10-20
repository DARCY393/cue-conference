-- Staff accounts — replaces the HOST_EMAIL bearer-token gate with real sign-in.
-- Safe to apply on existing DBs (IF NOT EXISTS / guarded).
-- Creates no rows — accounts are provisioned locally via `npm run staff:create`.

CREATE TABLE IF NOT EXISTS staff_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  name            text NOT NULL,
  password_hash   text NOT NULL,
  role            text NOT NULL DEFAULT 'admin',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_unique ON staff_users (lower(email));

CREATE TABLE IF NOT EXISTS staff_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id   uuid NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
  -- sha256 of the random session token carried in the signed cookie; the
  -- raw token is never stored, so a DB read alone can't forge a session.
  token_hash      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_sessions_token_hash_unique ON staff_sessions (token_hash);
CREATE INDEX IF NOT EXISTS staff_sessions_staff_user_id_idx ON staff_sessions (staff_user_id);
