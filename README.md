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
| Parking addon | **Removed** (off by default) — see [`docs/REMOVED_FEATURES.md`](./docs/REMOVED_FEATURES.md) |
| Hours | Mon–Fri 7:00–18:00 |
| Flow | Request-to-book + host accept/decline |
| Cancel | Flexible (grace / 7-day full / 24h partial) |
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
- Host UI: [http://localhost:3000/host](http://localhost:3000/host) — send `Authorization: Bearer <HOST_EMAIL>` (default `host@example.com`)


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

HOST_EMAIL=you@yourdomain.com
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

That applies pending migrations under `migrations/` (tracked in `schema_migrations`). On a **populated** Tailscale DB that already ran 001–008 without tracking, the first `db:migrate` bootstraps those filenames as applied and only runs new files (e.g. `009_locations.sql`, `010_arts_district_rooms.sql`). To apply one migration alone: `npm run db:migrate:009` / `npm run db:migrate:010`, or `psql "$DATABASE_URL" -f migrations/00X_….sql`.

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
- Host: `http://<tailscale-name-or-ip>:3000/host` (email must match `HOST_EMAIL`)

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

Migrations live in `migrations/001_…` … `010_arts_district_rooms.sql` (see `migrations/README.md`).

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

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (succeeds without DB/Stripe) |
| `npm run lint` | ESLint |
| `npm test` | Vitest — quote, Flexible refund, pricing, payment hold, Google Calendar sync |
| `npm run db:migrate` | Apply pending SQL migrations (schema_migrations) |
| `npm run db:migrate:009` | One-shot apply `009_locations.sql` only |
| `npm run db:migrate:010` | One-shot apply `010_arts_district_rooms.sql` only |

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
| POST | `/api/v1/webhooks/stripe` | Stripe events |

### Auth stub

- **Host**: `Authorization: Bearer <HOST_EMAIL>` or `X-Host-Email` matching `HOST_EMAIL`.
- **Guest**: identified by email on booking create (`guest.email`).

### Email

`lib/email.ts` exposes a `ConsoleEmailLogger` — messages are printed as JSON to the server console.

## Project layout

```
app/
  api/v1/…              OpenAPI-aligned route handlers
  spaces/[slug]         Guest listing + booking form (arts-district-m1..m4)
  host/                 Host queue UI
lib/
  features.ts           Removed-feature flags (discount/overtime/parking)
  quote.ts              Hours, long discount, addons, overtime
  refund.ts             Flexible cancellation math
  availability.ts       Bookable hours + overlap helpers
  seed.ts               Demo-mode location/room data
  space-public.ts       Strips private fields before API responses
  store.ts              In-memory demo store
  bookings.ts           Booking lifecycle
  stripe.ts             Stripe (test-mode only) or mock PI
  google-calendar.ts     Google Calendar sync (disabled/mock/live)
docs/REMOVED_FEATURES.md  Restore steps for removed pricing features
migrations/              Raw SQL (001–010)
openapi.yaml
__tests__/          quote, refund, pricing, payment-hold, google-calendar unit tests
```

## Demo mode behavior

If `DATABASE_URL` is unset, APIs use the seeded Cue Arts District listings in memory (M1–M4). If `STRIPE_SECRET_KEY` is unset, PaymentIntents return `pi_mock_*` / `*_secret_mock`. `npm run build` and `npm test` do not require either.
