# Cue Conference — booking MVP

Multi-location **Request-to-book** conference rooms (Cue Arts District · `arts-district-m1`, `arts-district-m2`, `arts-district-m3`, `arts-district-m4`).

Built with **Next.js App Router**, TypeScript, Tailwind, Postgres migrations, and Stripe PaymentIntents (`capture_method=manual`).

See [`DEPLOY.md`](./DEPLOY.md) for the VPS deploy runbook and
[`docs/REMOVED_FEATURES.md`](./docs/REMOVED_FEATURES.md) for pricing/billing
behaviors that were intentionally removed (and how to restore them).

## Branding

UI chrome follows the official **Cue design system**: navy (`--cue-navy-600`)
as the primary color, a single copper accent (`#B5651D`) reserved for one
conversion call-to-action per view, warm paper/stone neutrals, Jost for
display/headings and Public Sans for body text, and the Cue wordmark in the
header. There are no gradients, no emoji, and icons (where used) come from
`lucide-react`.

- Tokens: `app/globals.css` (`cue-navy-*`, `cue-copper-*`, `cue-stone-*`, `cue-paper`, radius/shadow/motion tokens as Tailwind v4 `@theme` variables)
- Fonts: loaded via `next/font/google` (Jost, Public Sans) — no self-hosted font files
- Logo / favicon: `public/branding/logo-cue-navy.png`, `logo-cue-light.png`, `favicon.png`
- Shared chrome: `app/layout.tsx` (sticky header → thecue.work, navy-800 footer with address/phone/email)

Visual-only restyle — booking logic, Stripe Payment Element, and validation are unchanged.

## Product defaults

| Setting | Value |
|--------|--------|
| Location | Cue Arts District (`arts-district`, legacy slug `downtown-arts-district` still resolves) |
| Rooms | `arts-district-m1` (M1, 10 seats), `arts-district-m2` (M2, 20 seats), `arts-district-m3` (M3, 5 seats), `arts-district-m4` (M4, 10 seats) |
| Address (public) | 750 N. St. Paul Street, Dallas, TX 75201 |
| Timezone | `America/Chicago` |
| Rate | M1 \$70/hr, M2 \$125/hr, M3 \$35/hr, M4 \$70/hr — per room (`baseHourlyCents` in `lib/seed.ts`; `DEFAULT_HOURLY_CENTS` is the default for new rooms) |
| Minimum | 1 hour per room (`minHours` in `lib/seed.ts`) — enforced server-side (quote + booking APIs) |
| Long booking discount | **Removed** (off by default) — see [`docs/REMOVED_FEATURES.md`](./docs/REMOVED_FEATURES.md) |
| Overtime | **Removed** (off by default) — see [`docs/REMOVED_FEATURES.md`](./docs/REMOVED_FEATURES.md) |
| Parking | $20/person/day reserved parking under the building, 0–20 passes, guest-selected on the room page. Always on — not the legacy addon-catalog mechanism (see [`docs/REMOVED_FEATURES.md`](./docs/REMOVED_FEATURES.md) #3), priced/stored on `bookings.parking_passes`/`parking_cents` (migration `014`), excluded from the 20% long-booking discount |
| Hours | Mon–Fri 7:00–18:00 |
| Flow | Request-to-book + host accept/decline |
| Cancel | Standard — free up to 48h before start, no refund after; host has 24h to respond or the hold auto-releases (`npm run bookings:expire` / cron) |
| Stripe | Test mode only — live keys (`sk_live_`/`rk_live_`/`pk_live_`) are refused unless `ALLOW_STRIPE_LIVE=true` |

Out of scope: Instant Book, marketplace fees.

## Locations & rooms

Spaces belong to a **location** (`locations` table). Guest URLs are `/spaces/{slug}`.

| Location slug | Name | Rooms |
|---------------|------|-------|
| `arts-district` (legacy: `downtown-arts-district`) | Cue Arts District | `arts-district-m1` (M1), `arts-district-m2` (M2), `arts-district-m3` (M3), `arts-district-m4` (M4) |

Legacy room slugs `cue-dallas` and `cue-downtown-boardroom` redirect (web) and resolve
via `getSpaceBySlug` (API): `cue-dallas` → `arts-district-m1`; `cue-downtown-boardroom`
→ homepage (no 1:1 replacement).

**Add a location + room (existing DB):**

1. Prefer `npm run db:migrate` (tracks applied files in `schema_migrations`; skips already-applied).
2. Or apply only the Arts District migration:
   ```bash
   npm run db:migrate:010
   # or: psql "$DATABASE_URL" -f migrations/010_arts_district_rooms.sql
   ```
3. For a *new* location later, insert into `locations`, then `spaces` (+ hours, amenities, addons, host_rules), or extend demo seed in `lib/seed.ts`.

**Per-room Google Calendar columns** (`spaces.google_calendar_id`,
`spaces.google_busy_calendar_ids`, `bookings.google_event_id`) were added in
migration `010`. They are never included in public API responses (stripped by
`lib/space-public.ts`'s `toPublicSpaceJson`, and `googleEventId` is stripped
from every booking response by `lib/bookings.ts`'s `sanitizeBookingForApi`).
See **Google Calendar sync** below.

## Google Calendar sync

Each room is backed by a Google **secondary calendar** (`c_…@group.calendar.google.com`,
owned by `darcy@thecue.work`) — not a Calendar "resource". M2 also has a second,
calendar ("SPP - M2 Conference Room"; the old "M2 - SPP" calendar is no longer used). These calendars must be shared with whichever
Google identity the app authenticates as, with **"Make changes to events"**
permission, or live-mode freebusy/event calls will fail.

Controlled by `GOOGLE_CALENDAR_MODE`:

| Mode | Behavior |
|------|----------|
| `disabled` (default) | No busy lookups, no events created/deleted. Logs once at startup. |
| `mock` | In-memory busy list + events, for local dev/tests. Seed busy via `GOOGLE_CALENDAR_MOCK_BUSY` (JSON) or `lib/google-calendar.ts`'s `setMockBusy()`. |
| `live` | Real Calendar API v3 calls via `fetch`, authenticated with `google-auth-library` (service account or OAuth refresh token — see `.env.example`). |

Behavior:

- **Availability** (`GET /api/v1/spaces/{id}/availability`, quotes, booking creation, host accept re-check) merges each room's Google busy with DB/demo busy. Calendar IDs/event IDs are never included in the response — only `kind: "google"` busy windows.
- **Fail closed**: if a live-mode freebusy call errors (API failure, or a calendar the credentials can't see), the slot is treated as unavailable and the request gets `409 calendar_unavailable` — "Room calendar unavailable; try again or contact hello@thecue.work". The error is logged server-side.
- **On accept**: after the PaymentIntent is captured, an event is created on the room's calendar (`summary: "Cue booking — {guest} ({room})"`, a private `cueBookingId` extended property). If calendar sync fails, the booking still gets accepted — the accept response carries a `calendarSyncWarning` field for staff instead.
- **On cancel/decline**: if the booking has a stored `google_event_id`, the event is deleted (404/410 ignored).

## Quick start (demo mode)

No database or Stripe required. Quotes, bookings, and host actions use an in-memory store; Stripe returns mock `client_secret` values.

```bash
cp .env.example .env   # optional; leave DATABASE_URL / STRIPE unset
npm install
npm test
npm run build
npm run dev
```

- Home (locations + rooms): [http://localhost:3000/](http://localhost:3000/)
- Guest UIs: [M1](http://localhost:3000/spaces/arts-district-m1) · [M2](http://localhost:3000/spaces/arts-district-m2) · [M3](http://localhost:3000/spaces/arts-district-m3) · [M4](http://localhost:3000/spaces/arts-district-m4)
- Host UI: [http://localhost:3000/host](http://localhost:3000/host) — redirects to [/staff/login](http://localhost:3000/staff/login) until you sign in. Create an account first: `STAFF_EMAIL=you@example.com STAFF_NAME="Your Name" npm run staff:create` (see **Staff accounts** below).


## Staff accounts

`/host` and `/api/v1/host/*` are gated by real staff accounts (`staff_users` +
`staff_sessions`, migration `012_staff_auth.sql`) instead of the old
`HOST_EMAIL` bearer token. Passwords are hashed with Node's built-in `scrypt`
(`lib/password.ts`) — plaintext is never stored or logged. Sessions are a
random token in an HTTP-only, signed cookie (`SESSION_SECRET` in `.env`);
`SESSION_SECRET` is required when `NODE_ENV=production` and falls back to a
per-process random value in development so local runs and tests don't need
one set.

No staff accounts are created by seed data or migrations. Create or update
one locally with:

```bash
STAFF_EMAIL=you@example.com STAFF_NAME="Your Name" npm run staff:create
# prompts for a password without echoing it, or read it from STAFF_PASSWORD
```

This upserts by (lowercased) email — rerun it to change a password or
reactivate an account. Multiple staff rows are supported (`role` column,
default `admin`); there's no UI to add more yet, just rerun the script with a
different `STAFF_EMAIL`.

Sign in at `/staff/login`; `/host` redirects there if there's no valid
session. Sign out from the host queue header, or `POST /api/v1/staff/logout`.

Without `DATABASE_URL` set, staff accounts/sessions live in the same
in-memory demo store as bookings — fine for local demos and tests, but note
`npm run staff:create` then only affects *its own* process, not a separately
running `npm run dev` server; set `DATABASE_URL` to share one account across
processes.

## Tailscale host — same-server Postgres checklist

Use this when the app runs on a machine reachable over Tailscale and Postgres lives on **that same host**. Keep Postgres off the public internet.

### 1. Install Postgres (Ubuntu/Debian example)

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Docker alternative (still bind to localhost only):

```bash
docker run -d --name cue-pg \
  -e POSTGRES_USER=cue \
  -e POSTGRES_PASSWORD='choose-a-strong-password' \
  -e POSTGRES_DB=cue \
  -p 127.0.0.1:5432:5432 \
  --restart unless-stopped \
  postgres:16
```

### 2. Create role + database (apt install path)

```bash
sudo -u postgres psql <<'SQL'
CREATE USER cue WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE cue OWNER cue;
\c cue
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- btree_gist is created by migration 001 as well
SQL
```

Confirm it listens locally only (typical default). Do **not** open `5432/udp` or `5432/tcp` in a public firewall. Tailscale access to the *app* is enough; the app uses `127.0.0.1`.

### 3. Clone app + Node

```bash
git clone https://github.com/DARCY393/cue-conference.git
cd cue-conference
# Node 18+ required
npm install
```

### 4. `.env` on the server

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

```bash
DATABASE_URL=postgres://cue:choose-a-strong-password@127.0.0.1:5432/cue

STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
# STRIPE_WEBHOOK_SECRET=whsec_...   # after `stripe listen` or a public webhook endpoint

HOST_EMAIL=you@yourdomain.com   # notification "to" address only, not an auth gate
SESSION_SECRET=paste-a-generated-value-here   # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
NEXT_PUBLIC_APP_URL=http://cue-server:3000
# Prefer your MagicDNS name or Tailscale IP, e.g.
# NEXT_PUBLIC_APP_URL=http://100.x.y.z:3000
```

Notes:
- `DATABASE_URL` must be `127.0.0.1` (or the Docker bridge only if Postgres is containerized and you know the network). Avoid `0.0.0.0` bind for Postgres.
- Setting `DATABASE_URL` leaves **demo/in-memory mode** and uses real SQL (migrations + seed).
- Stripe keys are optional until you want real Payment Element; without them you still get mock PI secrets.

### 5. Migrate + seed

```bash
npm run db:migrate
```

That applies pending migrations under `migrations/` (tracked in `schema_migrations`). On a **populated** Tailscale DB that already ran 001–008 without tracking, the first `db:migrate` bootstraps those filenames as applied and only runs new files (e.g. `009_locations.sql`, `010_arts_district_rooms.sql`, `012_staff_auth.sql`, `013_standard_cancellation_policy.sql`). To apply one migration alone: `npm run db:migrate:009` / `npm run db:migrate:010`, or `psql "$DATABASE_URL" -f migrations/00X_….sql`. Then create a staff account — see **Staff accounts** above.

### 6. Run the app (Tailscale-only access)

Dev:

```bash
npm run dev -- -H 0.0.0.0 -p 3000
```

Or production:

```bash
npm run build
npm run start -- -H 0.0.0.0 -p 3000
```

Bind `0.0.0.0` so other devices on your **tailnet** can hit the MagicDNS name/IP. Keep the host’s **public** firewall closed on `3000` unless you intentionally publish it. Access from your laptop over Tailscale:

- Home: `http://<tailscale-name-or-ip>:3000/`
- Guest: `…/spaces/arts-district-m1` (or `-m2`/`-m3`/`-m4`)
- Host: `http://<tailscale-name-or-ip>:3000/host` — sign in with a staff account (see **Staff accounts** above)

### 7. Stripe webhooks on a private host

Tailscale does not expose webhooks to Stripe by default. For test mode on the server:

```bash
# Install Stripe CLI, then:
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

Put the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET` and restart the app. For live mode later: Tailscale Funnel, Cloudflare Tunnel, or any public HTTPS reverse proxy.

### 8. Smoke test

1. Open guest page over Tailscale → request booking (Mon–Fri 7–18 Chicago).
2. With Stripe test keys: pay with `4242 4242 4242 4242`.
3. Host page → accept (captures) or decline (releases hold).
4. Confirm row in DB: `psql "$DATABASE_URL" -c "select id,status,total_cents from bookings order by created_at desc limit 5;"`

### Security quick list

- [ ] Postgres bound to localhost (or tailnet-only), not public
- [ ] `.env` mode `600`, not committed
- [ ] Strong DB password
- [ ] App port only needed on tailnet (or behind your chosen tunnel)
- [ ] Stripe **test** keys until go-live

## With Postgres + Stripe

1. Create a database and set `DATABASE_URL` in `.env`.
2. Apply migrations:

```bash
npm run db:migrate
```

Migrations live in `migrations/001_…` … `014_parking_and_reminders.sql` (see `migrations/README.md`).

3. Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (and optionally `STRIPE_WEBHOOK_SECRET`). See **Stripe test mode checklist** below.
4. `npm run dev`

Webhook endpoint: `POST /api/v1/webhooks/stripe`.


## Stripe test mode checklist

1. Copy `.env.example` → `.env` and set **test** keys:
   - `STRIPE_SECRET_KEY=sk_test_…`
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…`
2. Restart `npm run dev` so Next.js picks up `NEXT_PUBLIC_*`.
3. Open the guest page, request a booking, then enter card **`4242 4242 4242 4242`** (any future expiry, any CVC) in the Payment Element and confirm.
4. In the host UI, **accept** the request — that captures the manual-capture PaymentIntent. Decline cancels the hold.

Without Stripe keys, bookings still work with mock `*_secret_mock` client secrets (demo mode banner on the guest form).

## Booking flow: nothing is sent until the card is authorized

1. Filling in the form (including leaving the email field) only fetches price quotes. Nothing is stored.
2. **Continue to payment** creates a `draft` booking and a manual-capture PaymentIntent. The browser sends a
   per-attempt `clientRequestKey`, so a double click or retry returns the same draft. Drafts hold no
   inventory, send no email, and are hidden from staff.
3. After `stripe.confirmPayment` reports `requires_capture`, the browser calls
   `POST /api/v1/bookings/:id/authorize`. The server re-checks the PaymentIntent with Stripe (status and amount)
   and the slot, then promotes the draft to `requested` and sends the guest "request received" email and the
   host alert, exactly once. The `payment_intent.amount_capturable_updated` webhook does the same if the tab closes.
4. **Change date, time or details** (`POST /api/v1/bookings/:id/discard`) cancels the draft's PaymentIntent and
   unlocks the form. Drafts not authorized within 30 minutes are expired by the expiry job, with the PI cancelled.

## Stripe Connect (Honeycomb platform fee) — optional, OFF by default

Honeycomb's Stripe account is the **platform**; the SPP/Cue Stripe account is the
**connected account**. With Connect on, the app uses the platform secret key and
sends every call with `Stripe-Account: <connected acct>` (direct charges):

- Booking hold: manual-capture PaymentIntent with
  `application_fee_amount = round(APPLICATION_FEE_BPS × charged amount / 10000)`
  (default 1000 bps = 10%, parking and add-ons included). The fee is collected on
  capture; a decline, cancel or 24h auto-decline cancels the PI and releases it.
- Overtime/damage off-session PaymentIntents get the same fee on the full amount.
- Refunds pass `refund_application_fee: true`, so Honeycomb's fee is returned pro rata.
- `APPLICATION_FEE_ROOM_ONLY=true` bases the booking fee on room time only
  (room subtotal after the long-booking discount, no parking/add-ons).
- Every PI keeps the Cue Arts District Conference Room tags (metadata
  `business=cue_arts_district_conference_room`, description, and
  `statement_descriptor_suffix` `CUE ARTS DIST`).

Setup (test mode first):

1. In Honeycomb's Stripe dashboard (test mode) enable Connect and finish the platform profile.
2. Connect the SPP/Cue account. Either:
   - **Existing SPP account (Standard):** create an OAuth link from Settings → Connect →
     Onboarding options (OAuth) and have D'Arcy approve it while signed in to the SPP
     account, or create an account link for it; or
   - **Test only:** create a test connected account
     (`POST /v1/accounts` with `type=standard` or `type=express`) and complete its
     onboarding link with Stripe's test data.
3. Set in the env file: `STRIPE_PLATFORM_SECRET_KEY` (Honeycomb sk_test_),
   `STRIPE_CONNECTED_ACCOUNT_ID` and `NEXT_PUBLIC_STRIPE_CONNECTED_ACCOUNT_ID` (acct_…),
   `APPLICATION_FEE_BPS=1000`, and switch `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to
   **Honeycomb's** pk_test_. NEXT_PUBLIC_* values are baked in at build time, so rebuild.
4. Webhooks: add a **Connect** endpoint on the platform ("Listen to events on Connected
   accounts") pointing at `/api/v1/webhooks/stripe` and put its signing secret in
   `STRIPE_CONNECT_WEBHOOK_SECRET`. The route verifies with either secret; Connect events
   for any account other than `STRIPE_CONNECTED_ACCOUNT_ID` are acknowledged and ignored.
5. Going live needs D'Arcy's explicit approval (`ALLOW_STRIPE_LIVE=true` plus live keys).

To turn Connect off, remove `STRIPE_PLATFORM_SECRET_KEY` / `STRIPE_CONNECTED_ACCOUNT_ID`,
restore the SPP pk_test_ and rebuild. Note: PaymentIntents created under Connect live on the
connected account, so capture/refund of those needs Connect to stay on until they settle.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (succeeds without DB/Stripe) |
| `npm run lint` | ESLint |
| `npm test` | Vitest — quote, cancellation refund, booking lifecycle/expiry, pricing, payment hold, Google Calendar sync, staff auth |
| `npm run db:migrate` | Apply pending SQL migrations (schema_migrations) |
| `npm run db:migrate:009` | One-shot apply `009_locations.sql` only |
| `npm run db:migrate:010` | One-shot apply `010_arts_district_rooms.sql` only |
| `npm run staff:create` | Upsert one staff account (`STAFF_EMAIL`/`STAFF_NAME`/`STAFF_PASSWORD` env, or a hidden password prompt) |
| `npm run bookings:expire` | Auto-decline "requested" bookings past their 24h host response window (releasing each hold) and send due 24h-before-start reminders — run on a cron |
| `npm run email:preview` | Write a sample confirmation email's rendered HTML to `/workspace/tmp/email-confirmation.html` |

## API

> **Next.js note:** App Router requires a single dynamic segment name under `spaces/`, so handlers live at `app/api/v1/spaces/[spaceId]/…`. `GET /api/v1/spaces/arts-district-m1` still works — the param accepts either slug or UUID. Legacy slugs like `cue-dallas` also resolve.


OpenAPI: [`openapi.yaml`](./openapi.yaml). Routes are mounted under **`/api/v1`** (local convenience vs the `/v1` servers in the spec).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/spaces` | List live spaces (`?grouped=1` by location) |
| GET | `/api/v1/spaces/{slug}` | Public listing |
| GET | `/api/v1/spaces/{spaceId}/availability` | Busy intervals |
| POST | `/api/v1/spaces/{spaceId}/quotes` | Price window |
| POST | `/api/v1/bookings` | Create + PI (manual capture) |
| GET | `/api/v1/bookings/{id}` | Booking detail |
| POST | `/api/v1/bookings/{id}/cancel` | Flexible refund |
| GET | `/api/v1/host/bookings` | Host queue |
| POST | `/api/v1/host/bookings/{id}/accept` | Capture PI |
| POST | `/api/v1/host/bookings/{id}/decline` | Cancel hold |
| POST | `/api/v1/host/bookings/{id}/overtime` | 30-min OT charge |
| GET/POST | `/api/v1/host/blockouts` | List / create |
| DELETE | `/api/v1/host/blockouts/{id}` | Remove |
| POST | `/api/v1/staff/login` | Staff sign-in; sets the session cookie |
| POST | `/api/v1/staff/logout` | Clears the session |
| GET | `/api/v1/staff/me` | Current staff user, or 401 |
| POST | `/api/v1/webhooks/stripe` | Stripe events |
| POST | `/api/v1/internal/expire-requests` | Cron target — auto-decline overdue `requested` bookings, release each hold, send due reminders |
| POST | `/api/contact` | Room-page "Questions?" form — not versioned under `/api/v1` |

### Auth

- **Host**: signed, HTTP-only `cue_staff_session` cookie set by `/api/v1/staff/login` (see **Staff accounts** above). `/api/v1/host/*` returns 401 without a valid session.
- **Guest**: identified by email on booking create (`guest.email`).
- **Cron**: `/api/v1/internal/expire-requests` requires `Authorization: Bearer <CRON_SECRET>`; 503 if `CRON_SECRET` isn't set, 401 if the header is missing/wrong.

### Email

`lib/email.ts` sends real email via SMTP (`nodemailer`) once `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` are all set (port
`465` uses TLS; anything else uses STARTTLS). Without all five, it falls back
to a `ConsoleEmailLogger` that prints `to`/`subject`/`template` (never the
full HTML body) as JSON to the server console. Send failures are caught and
logged — they never break the booking flow.

Branded HTML + plain-text templates live in `lib/email-templates.ts`
(navy header, "cue" wordmark, copper accent, Jost/Public Sans with web-safe
fallbacks, table layout for email-client compatibility): booking request
received, booking confirmed, 24h-before-start reminder, booking
declined/cancelled/expired, and the host new-request notification. Arrival
instructions (address, parking, Wi-Fi, amenities, D'Arcy's contact info) are
centralized in `lib/arrival-instructions.ts`, shared by the HTML and text
renderers — the Wi-Fi password only ever appears in these emails, never on
the public room page. Preview the confirmation email's rendered HTML with
`npx tsx scripts/render-email-preview.ts` (writes to
`/workspace/tmp/email-confirmation.html`).

Reminders: `lib/reminders.ts`'s `sendDueReminders()` finds accepted bookings
starting within 24h that haven't been reminded yet, sends the reminder email,
and stamps `reminder_sent_at` — idempotent, so re-running it (same cron tick
or a retry) never double-sends. Called from both `npm run bookings:expire`
and `POST /api/v1/internal/expire-requests`, right after the overdue-request
expiry scan.

### Contact form

The room page's "Questions?" section posts to `POST /api/contact`
(`app/api/contact/route.ts`), which validates `name`/`email`/`message`,
silently no-ops on a filled honeypot field (`website`), rate-limits to 5
requests per 10 minutes per IP (`x-forwarded-for`/`x-real-ip`), and emails
`CONTACT_EMAIL` (default `darcy@thecue.work`) with `replyTo` set to the
guest's address via the same `lib/email.ts` sender.

## Project layout

```
app/
  api/v1/…              OpenAPI-aligned route handlers
  spaces/[slug]         Guest listing + booking form (arts-district-m1..m4)
  host/                 Host queue UI (redirects to /staff/login if signed out)
  staff/login/          Staff sign-in page
lib/
  features.ts           Removed-feature flags (discount/overtime/legacy parking addon)
  quote.ts              Hours, long discount, addons, overtime, parking-passes pricing
  refund.ts             Flexible cancellation math
  availability.ts       Bookable hours + overlap helpers
  seed.ts               Demo-mode location/room data
  space-public.ts       Strips private fields before API responses
  store.ts              In-memory demo store (bookings, blockouts, staff users/sessions)
  bookings.ts           Booking lifecycle
  reminders.ts           24h-before-start reminder emails (idempotent)
  email.ts                SMTP (nodemailer) or console-log email sender
  email-templates.ts      Branded HTML/text email renderers
  arrival-instructions.ts Shared arrival/access instructions (email-only)
  validate.ts             Small shared input validators (e.g. isValidEmail)
  stripe.ts             Stripe (test-mode only) or mock PI
  google-calendar.ts     Google Calendar sync (disabled/mock/live)
  password.ts            scrypt password hashing
  staff-auth.ts           Staff login/session/cookie logic (DB + in-memory)
scripts/create-staff-user.ts  `npm run staff:create` CLI
scripts/render-email-preview.ts  Writes a sample confirmation email's HTML to /workspace/tmp
docs/REMOVED_FEATURES.md  Restore steps for removed pricing features
migrations/              Raw SQL (001–014)
openapi.yaml
__tests__/          quote, refund, pricing, payment-hold, google-calendar, staff-auth, reminders, contact, email-template unit tests
```

## Demo mode behavior

If `DATABASE_URL` is unset, APIs use the seeded Cue Arts District listings in memory (M1–M4). If `STRIPE_SECRET_KEY` is unset, PaymentIntents return `pi_mock_*` / `*_secret_mock`. `npm run build` and `npm test` do not require either.
