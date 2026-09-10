# Cue Conference — booking MVP

Single-space **Request-to-book** conference room (Cue · Dallas · `cue-dallas`).

Built with **Next.js App Router**, TypeScript, Tailwind, Postgres migrations, and Stripe PaymentIntents (`capture_method=manual`).

## Product defaults

| Setting | Value |
|--------|--------|
| Slug | `cue-dallas` |
| Timezone | `America/Chicago` |
| Capacity | 10 |
| Rate | \$70/hr (7000¢) |
| Minimum | 1 hour |
| Long booking | 20% off at 8+ hours |
| Overtime | 1.5× per 30 minutes |
| Parking addon | \$25/day (2500¢) |
| Hours | Mon–Fri 7:00–18:00 |
| Flow | Request-to-book + host accept/decline |
| Cancel | Flexible (grace / 7-day full / 24h partial) |

Out of scope: Instant Book, marketplace, multi-space.

## Quick start (demo mode)

No database or Stripe required. Quotes, bookings, and host actions use an in-memory store; Stripe returns mock `client_secret` values.

```bash
cp .env.example .env   # optional; leave DATABASE_URL / STRIPE unset
npm install
npm test
npm run build
npm run dev
```

- Guest UI: [http://localhost:3000/spaces/cue-dallas](http://localhost:3000/spaces/cue-dallas)
- Host UI: [http://localhost:3000/host](http://localhost:3000/host) — send `Authorization: Bearer <HOST_EMAIL>` (default `host@example.com`)

## With Postgres + Stripe

1. Create a database and set `DATABASE_URL` in `.env`.
2. Apply migrations:

```bash
npm run db:migrate
```

Migrations live in `migrations/001_extensions.sql` … `008_seed_cue.sql` (see `migrations/README.md`).

3. Set `STRIPE_SECRET_KEY` (and optionally `STRIPE_WEBHOOK_SECRET`).
4. `npm run dev`

Webhook endpoint: `POST /api/v1/webhooks/stripe`.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (succeeds without DB/Stripe) |
| `npm run lint` | ESLint |
| `npm test` | Vitest — quote + Flexible refund math |
| `npm run db:migrate` | Apply SQL migrations in order |

## API

> **Next.js note:** App Router requires a single dynamic segment name under `spaces/`, so handlers live at `app/api/v1/spaces/[spaceId]/…`. `GET /api/v1/spaces/cue-dallas` still works — the param accepts either slug or UUID.


OpenAPI: [`openapi.yaml`](./openapi.yaml). Routes are mounted under **`/api/v1`** (local convenience vs the `/v1` servers in the spec).

| Method | Path | Notes |
|--------|------|--------|
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
  api/v1/…          OpenAPI-aligned route handlers
  spaces/cue-dallas Guest listing + booking form
  host/             Host queue UI
lib/
  quote.ts          Hours, long discount, addons, overtime
  refund.ts         Flexible cancellation math
  availability.ts   Bookable hours + overlap helpers
  store.ts          In-memory demo store
  bookings.ts       Booking lifecycle
  stripe.ts         Stripe or mock PI
migrations/         Raw SQL (001–008)
openapi.yaml
__tests__/          quote + refund unit tests
```

## Demo mode behavior

If `DATABASE_URL` is unset, APIs use the seeded Cue listing in memory. If `STRIPE_SECRET_KEY` is unset, PaymentIntents return `pi_mock_*` / `*_secret_mock`. `npm run build` and `npm test` do not require either.
