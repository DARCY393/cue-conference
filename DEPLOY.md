# Deploying `cue-conference` to book.thecue.work

Target: D'Arcy's Hostinger VPS at `217.196.48.137` (assumed Ubuntu — if it's
something else, adjust package-manager commands accordingly), serving
`https://book.thecue.work`. Every command below needs `sudo` unless noted.

## 1. Overview

- This is a **test-mode** deployment: Stripe stays on `sk_test_…`/`pk_test_…`
  keys end to end. The app refuses live keys unless `ALLOW_STRIPE_LIVE=true`
  is explicitly set (see §11) — do not set that flag as part of this guide.
- **Nothing goes live until D'Arcy approves.** Specifically, get his OK before:
  - [ ] Pointing the `book.thecue.work` DNS record at this VPS
  - [ ] Issuing the TLS certificate (first real traffic touchpoint)
  - [ ] Sharing the Google Calendars with the service account (live calendar sync)
  - [ ] Linking/embedding the booking flow from thecue.work (§14)
  - [ ] Removing the Amelia plugin (§14 — only after the new flow is verified)
  - [ ] Any future switch to Stripe live keys (separate, explicitly approved step — §11)

## 2. DNS

Add an **A record**: `book` → `217.196.48.137`, TTL `300`.

Set it wherever `thecue.work`'s DNS is managed today — that's the Hostinger
hPanel DNS zone if the domain's nameservers point at Hostinger, or the
registrar's own DNS panel if not. Check with:

```bash
dig +short NS thecue.work
```

Whoever controls the zone shown there is where the record goes. After adding it,
verify propagation:

```bash
dig +short A book.thecue.work
# should eventually print 217.196.48.137
```

Propagation with a 300s TTL is usually fast, but can take longer depending on
resolvers/caching.

## 3. System packages

All on the VPS, as a sudo-capable user:

```bash
sudo apt update && sudo apt upgrade -y

# Node 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # expect v20.x

# The repo ships package-lock.json, so npm is the default package manager —
# npm ci is used below, not pnpm/yarn. (corepack enable ships with Node 20 if
# you ever want pnpm for something else.)

sudo apt install -y git nginx

# certbot for Let's Encrypt via the nginx plugin
sudo apt install -y python3-certbot-nginx

# PostgreSQL (16 or 17 — whichever Ubuntu's default repo offers)
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
psql --version
```

## 4. App user + clone

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin cue
sudo mkdir -p /srv/cue-conference
sudo chown cue:cue /srv/cue-conference

sudo -u cue git clone https://github.com/DARCY393/cue-conference.git /srv/cue-conference
cd /srv/cue-conference
sudo -u cue git checkout feature/arts-district-amelia-replacement   # or the release tag D'Arcy specifies
```

## 5. Postgres

```bash
sudo -u postgres psql <<'SQL'
CREATE USER cue_app WITH PASSWORD 'REPLACE_WITH_A_STRONG_PASSWORD';
CREATE DATABASE cue_conference OWNER cue_app;
\c cue_conference
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL
```

`DATABASE_URL` (goes in the env file in §6):

```
postgresql://cue_app:REPLACE_WITH_A_STRONG_PASSWORD@127.0.0.1:5432/cue_conference
```

Keep Postgres bound to `127.0.0.1` (the Ubuntu default) — never expose 5432
publicly.

Run migrations as the `cue` user, with `DATABASE_URL` in the environment:

```bash
cd /srv/cue-conference
sudo -u cue env DATABASE_URL='postgresql://cue_app:...@127.0.0.1:5432/cue_conference' npm run db:migrate
```

Verify the 4 Arts District rooms landed:

```bash
sudo -u postgres psql cue_conference -c "select slug, capacity, base_hourly_cents, min_hours from spaces order by slug;"
# expect arts-district-m1..m4, rates $70/$125/$35/$70, min_hours = 1
```

**Backups** — daily `pg_dump` via cron, kept for a rolling window:

```bash
sudo -u postgres mkdir -p /var/backups/cue-conference
sudo crontab -u postgres -e
# add:
# 15 3 * * * pg_dump cue_conference | gzip > /var/backups/cue-conference/cue_conference_$(date +\%Y\%m\%d).sql.gz
# 20 3 * * * find /var/backups/cue-conference -name '*.sql.gz' -mtime +14 -delete
```

## 6. Env file — `/etc/cue-conference.env`

```bash
sudo touch /etc/cue-conference.env
sudo chown root:cue /etc/cue-conference.env
sudo chmod 600 /etc/cue-conference.env
```

Contents (every variable from `.env.example`, explained — **no real secret
values are shown here**, fill them in on the box):

```ini
# Postgres — role/db created in §5
DATABASE_URL=postgresql://cue_app:REPLACE_WITH_A_STRONG_PASSWORD@127.0.0.1:5432/cue_conference

# Stripe — TEST MODE keys only (dashboard.stripe.com/test/apikeys), see §11
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME

# Must stay UNSET. The app refuses sk_live_/rk_live_/pk_live_ keys unless this
# is "true", and this file is not where that gets turned on (see §11).
# ALLOW_STRIPE_LIVE=

# Shared bearer for /host and /api/v1/host/* (see §13 — also lock this down at nginx)
HOST_EMAIL=REPLACE_WITH_STAFF_EMAIL

# Public app URL — NEXT_PUBLIC_* vars are baked in at `next build` time.
# If you change this (or any NEXT_PUBLIC_* var) later, you MUST rebuild (§7/§15),
# not just restart.
NEXT_PUBLIC_APP_URL=https://book.thecue.work

# Google Calendar sync — see §12. Leave GOOGLE_CALENDAR_MODE unset/disabled
# until the calendars are shared with the service account.
# GOOGLE_CALENDAR_MODE=live
# GOOGLE_CALENDAR_SERVICE_ACCOUNT_FILE=/etc/cue-conference/google-sa.json

# Origins allowed to iframe this app (CSP frame-ancestors), space-separated.
# thecue.work and www.thecue.work are always allowed by default even if unset;
# only set this for extra origins (e.g. a staging host).
# EMBED_ALLOWED_ORIGINS=

# Pricing feature flags — leave unset (off). See docs/REMOVED_FEATURES.md.
# PRICING_ENABLE_LONG_BOOKING_DISCOUNT=
# PRICING_ENABLE_OVERTIME=
# PRICING_ENABLE_PARKING_ADDON=
```

## 7. Build

```bash
cd /srv/cue-conference
sudo -u cue npm ci
sudo -u cue env $(grep -v '^#' /etc/cue-conference.env | xargs -d '\n') npm run build
```

(The build step needs the `NEXT_PUBLIC_*` vars present because Next.js bakes
them into the client bundle — hence passing the env file through here, not
just at runtime.)

## 8. systemd service

`/etc/systemd/system/cue-conference.service`:

```ini
[Unit]
Description=Cue Conference booking app
After=network.target postgresql.service

[Service]
Type=simple
User=cue
WorkingDirectory=/srv/cue-conference
EnvironmentFile=/etc/cue-conference.env
ExecStart=/usr/bin/npm run start -- -p 3100 -H 127.0.0.1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cue-conference
sudo systemctl status cue-conference
sudo journalctl -u cue-conference -f
```

*Alternative:* `pm2 start npm --name cue-conference -- run start -- -p 3100 -H 127.0.0.1`
works too, but systemd is simpler to reason about for a single app on a VPS —
stick with the unit above unless you already run pm2 for other services.

## 9. nginx

`/etc/nginx/sites-available/book.thecue.work`:

```nginx
server {
    listen 80;
    server_name book.thecue.work;

    client_max_body_size 10m;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/book.thecue.work /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 10. TLS (certbot)

Only once DNS (§2) resolves to this box and D'Arcy has approved going live on
the subdomain:

```bash
sudo certbot --nginx -d book.thecue.work
```

Certbot edits the nginx server block to add the 443 listener + redirect.
Check auto-renew:

```bash
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

## 11. Stripe (TEST MODE)

- Get **test** keys from `https://dashboard.stripe.com/test/apikeys`
  (`sk_test_…` / `pk_test_…`) and put them in `/etc/cue-conference.env` (§6).
- Create a webhook endpoint in the Stripe dashboard (test mode) pointing at:

  ```
  https://book.thecue.work/api/v1/webhooks/stripe
  ```

  Subscribe it to exactly the events the code handles
  (`app/api/v1/webhooks/stripe/route.ts`):
  - `payment_intent.amount_capturable_updated`
  - `payment_intent.succeeded`
  - `payment_intent.canceled`
  - `charge.refunded`

- Copy the signing secret it gives you (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
- Test card: `4242 4242 4242 4242`, any future expiry, any CVC.
- **Going live is a separate, explicitly approved step**, not part of this
  deploy: the app (`lib/stripe.ts`) refuses `sk_live_`/`rk_live_`/`pk_live_`
  keys unless `ALLOW_STRIPE_LIVE=true` is set. When D'Arcy approves going
  live: swap in live keys, create a **new** live-mode webhook endpoint (same
  path, new `whsec_…`), set `ALLOW_STRIPE_LIVE=true`, then rebuild (§7/§15) —
  changing env vars alone does not take effect without a rebuild+restart.

## 12. Google Calendar sync

Each room's calendar is a Google **secondary calendar**
(`c_…@group.calendar.google.com`) owned by `darcy@thecue.work`, not a Calendar
resource. Sync is controlled by `GOOGLE_CALENDAR_MODE` (`disabled` by
default, `live` once wired up).

1. In Google Cloud Console, create (or reuse) a project, then enable the
   **Google Calendar API**.
2. Create a **service account**, generate a JSON key for it.
3. Copy the JSON key to the server and lock it down:

   ```bash
   sudo mkdir -p /etc/cue-conference
   sudo cp google-sa-downloaded.json /etc/cue-conference/google-sa.json
   sudo chown root:cue /etc/cue-conference/google-sa.json
   sudo chmod 600 /etc/cue-conference/google-sa.json
   ```

4. Set in `/etc/cue-conference.env`:

   ```ini
   GOOGLE_CALENDAR_MODE=live
   GOOGLE_CALENDAR_SERVICE_ACCOUNT_FILE=/etc/cue-conference/google-sa.json
   ```

5. **Share every one of these 5 calendars** with the service account's
   email (the `client_email` field in the JSON key), with **"Make changes to
   events"** permission (full calendar IDs from `lib/seed.ts`):

   | Room | Calendar name | Calendar ID |
   |------|---------------|-------------|
   | M1 | SPP - M1 Conference Room | `c_e88039667398de2f9dd4f5b5c52147b034323e48620c7cb4c278eefcdc0601a6@group.calendar.google.com` |
   | M2 | SPP - M2 Conference Room | `c_8b3363b1a13418a42df25d270780f453fa4f4e2de9be4b5d85bc3119ea23ff3a@group.calendar.google.com` |

   | M3 | SPP - M3 Conference Room | `c_fa24824eeb56172234a4e332185b1590926da705c57c76d6d99d3a164f696ba6@group.calendar.google.com` |
   | M4 | SPP - M4 Conference Room | `c_44bb9580defceabfbb00be84aee1b13223c607efffc9051673f813a5e03a6152@group.calendar.google.com` |

   If the service account's project lives outside the `thecue.work` Google
   Workspace domain, a Workspace admin may need to allow external sharing
   before these calendars can be shared with it — ask D'Arcy to check that
   with whoever admins the Workspace if sharing fails silently.

   **Alternative:** instead of a service account, you can authenticate as
   `darcy@thecue.work` directly via OAuth (`GOOGLE_CALENDAR_CLIENT_ID` /
   `_CLIENT_SECRET` / `_REFRESH_TOKEN` in `.env.example`) — useful if Workspace
   sharing restrictions make the service-account route painful. Either path
   ends up authenticating as an identity the 5 calendars above are shared with.

6. **Fail-closed behavior**: if a live freebusy call errors (bad credentials,
   a calendar not shared, API outage), the app treats that slot as
   unavailable and returns `409 calendar_unavailable` rather than risking a
   double-booking. On accept, if the calendar event can't be created, the
   booking is still accepted but the host UI surfaces a `calendarSyncWarning`
   instead of silently losing the booking.

Leave `GOOGLE_CALENDAR_MODE` unset (disabled) until all 5 calendars are
confirmed shared — do not flip to `live` early.

## 13. Staff access to `/host`

The `/host` screen and `/api/v1/host/*` currently use a single shared
`HOST_EMAIL` bearer token — there's no real staff login yet. Until there is,
put an extra layer in front at nginx: HTTP basic auth (simplest) or an IP
allowlist.

Basic auth example, added inside the `server { }` block from §9:

```nginx
location /host {
    auth_basic "Cue staff";
    auth_basic_user_file /etc/nginx/.htpasswd-cue-host;
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/v1/host/ {
    auth_basic "Cue staff";
    auth_basic_user_file /etc/nginx/.htpasswd-cue-host;
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Generate the credentials file:

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-cue-host darcy
sudo nginx -t && sudo systemctl reload nginx
```

(IP allowlisting via `allow`/`deny` directives is the alternative if staff
only ever connect from known IPs/VPN.)

## 14. Linking/embedding from thecue.work

Per-room links — plain buttons, no iframe, for an Elementor HTML widget:

```html
<a class="elementor-button" href="https://book.thecue.work/spaces/arts-district-m1">Book M1</a>
<a class="elementor-button" href="https://book.thecue.work/spaces/arts-district-m2">Book M2</a>
<a class="elementor-button" href="https://book.thecue.work/spaces/arts-district-m3">Book M3</a>
<a class="elementor-button" href="https://book.thecue.work/spaces/arts-district-m4">Book M4</a>
```

Optional iframe embed (compact layout, no site header/footer):

```html
<iframe
  src="https://book.thecue.work/spaces/arts-district-m1?embed=1"
  style="width:100%;min-height:900px;border:0"
  title="Book Cue Arts District M1"
></iframe>
```

This is only possible because of the `Content-Security-Policy:
frame-ancestors` header set in `next.config.ts` (§B of the implementation —
allows `thecue.work`/`www.thecue.work` by default, extra origins via
`EMBED_ALLOWED_ORIGINS`). The app intentionally does **not** send
`X-Frame-Options: DENY`, since that would block this iframe outright.

The legacy URL `/spaces/cue-dallas` redirects to `/spaces/arts-district-m1`
automatically, so any old links/bookmarks keep working.

Only remove the **Amelia** WordPress plugin from thecue.work after the new
flow above has been verified end-to-end and D'Arcy has signed off — don't
deactivate it as part of this deploy.

## 15. Updating / rollback

Update:

```bash
cd /srv/cue-conference
sudo -u cue git pull
sudo -u cue npm ci
sudo -u cue env DATABASE_URL='...' npm run db:migrate
sudo -u cue env $(grep -v '^#' /etc/cue-conference.env | xargs -d '\n') npm run build
sudo systemctl restart cue-conference
```

Rollback to the previous known-good state:

```bash
cd /srv/cue-conference
sudo -u cue git checkout <previous-tag-or-commit>
sudo -u cue npm ci
sudo -u cue env $(grep -v '^#' /etc/cue-conference.env | xargs -d '\n') npm run build
sudo systemctl restart cue-conference
```

(Migrations are additive/forward-only in this repo — rolling back code does
not roll back the schema. If a migration ever needs reverting, that's a
manual SQL step, not part of this script.)

## 16. Smoke test checklist

- [ ] `https://book.thecue.work/` loads over HTTPS, shows Cue Arts District
      with 4 room cards (M1–M4) and correct per-room rates
- [ ] `dig +short A book.thecue.work` returns `217.196.48.137`
- [ ] `/spaces/arts-district-m1` through `-m4` each load, show seats/rate/amenities
- [ ] `/spaces/cue-dallas` redirects to `/spaces/arts-district-m1`
- [ ] Request a booking on a weekday 7:00–18:00 America/Chicago slot; quote
      total matches `rate × hours`
- [ ] Pay with Stripe test card `4242 4242 4242 4242` — Payment Element
      confirms (or, if no Stripe keys are set yet, the mock-hold alert shows
      instead and the booking still completes)
- [ ] `/host` requires the basic-auth/IP gate from §13, then the app's own
      `HOST_EMAIL` bearer
- [ ] Host queue shows the new request with room/guest/time (America/Chicago)/total
- [ ] **Accept** captures the PaymentIntent (check Stripe dashboard test mode)
      and, once Google Calendar is live, creates a calendar event on the room's calendar
- [ ] **Decline** on a separate test booking cancels the hold (no capture)
- [ ] `psql` check: `select slug, status, total_cents from bookings order by created_at desc limit 5;`
- [ ] Stripe webhook endpoint shows successful deliveries (test mode dashboard)
- [ ] `?embed=1` on a room page hides header/footer and renders compactly
- [ ] iframe test page on a `thecue.work`-origin host actually loads the embed (not blocked by CSP)
