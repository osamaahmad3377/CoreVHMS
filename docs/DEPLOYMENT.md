# Deployment guide

How to run NextCore VCMS in production with Docker. For day-to-day operations (backups, monitoring,
incidents) see [OPERATIONS.md](OPERATIONS.md); for security controls see [SECURITY.md](SECURITY.md).

## 1. What gets deployed

| Service | Image | Notes |
|---|---|---|
| `db` | `postgres:16-alpine` | Data in the `db-data` volume. Not published on the host. |
| `api` | built from `docker/api.Dockerfile` | NestJS API. Applies pending database migrations on start, then serves `:4000` inside the network. Uploaded files in the `storage` volume. Runs as the unprivileged `node` user. |
| `web` | built from `docker/web.Dockerfile` | Next.js standalone server on `:3000`. Forwards `/api/*` to the API, so the browser only ever talks to one origin. |

You provide: a Linux host (2 vCPU / 4 GB RAM is enough for one clinic), Docker Engine 24+ with the Compose
plugin, a domain name, an **HTTPS reverse proxy** in front of `web`, and an SMTP account for outgoing email.

## 2. First installation

```bash
git clone <repository> nextcore-vcms && cd nextcore-vcms
cp .env.production.example .env.production
openssl rand -hex 32   # run three times: POSTGRES_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY
nano .env.production   # fill in APP_URL, the secrets, SMTP settings
```

Required settings (`.env.production`):

| Variable | Purpose |
|---|---|
| `APP_URL` | Public HTTPS address, e.g. `https://clinic.example.com`. Used in emails and to reject cross-origin requests. |
| `POSTGRES_PASSWORD` | Database password (random, 32+ characters). |
| `SESSION_SECRET` | Random 32-byte hex value. The API refuses to start with a placeholder. |
| `ENCRYPTION_KEY` | Random 32-byte hex value. Encrypts MFA secrets at rest. **Store a copy in your password manager** — see OPERATIONS.md §5. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Outgoing email for invitations, password resets, reminders and referral letters. |
| `COOKIE_SECURE=true`, `TRUST_PROXY=1` | Secure cookies; trust one reverse-proxy hop for client IP addresses (rate limiting, audit log). |

Optional: `ALLOW_SIGNUP` (default `false` in production), `API_DOCS` (Swagger UI, default off),
`LOG_FORMAT` (`json`), `MAX_UPLOAD_MB`, `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`,
`CLIENT_PORTAL_ENABLED` (client portal, off — also a build argument of the web image), `WEB_BIND`/`WEB_PORT`.

The API **refuses to start in production** if a secret looks like a placeholder, the database uses the
development password, or secure cookies are off (override for a local trial only with `ALLOW_INSECURE_COOKIES=true`).

Building the web image needs internet access once: the fonts clinics can choose in Settings → Branding are
downloaded at build time and then served by the app itself (browsers never contact Google).

Build and start:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps     # all three "healthy"
```

### Creating the clinic (first organisation)

Self-registration is off in production. For the very first start, set `ALLOW_SIGNUP=true`, restart the API,
open `https://<your domain>/register` and create the organisation and owner account, then set
`ALLOW_SIGNUP=false` and restart the API again:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d api
```

Then follow the in-app **Set up your clinic** checklist on the dashboard (branch details, staff invitations,
working hours, services and prices, stock locations, tax rates). **Do not run the demo seed in production** —
the seed script refuses to run when `NODE_ENV=production`.

## 3. HTTPS reverse proxy

The web container listens on `127.0.0.1:3000` by default (`WEB_BIND`). Terminate TLS in front of it. With
[Caddy](https://caddyserver.com) (automatic Let's Encrypt certificates), `/etc/caddy/Caddyfile`:

```
clinic.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:3000
    request_body {
        max_size 25MB
    }
}
```

nginx works equally well (`proxy_pass http://127.0.0.1:3000;` with `X-Forwarded-For`/`X-Forwarded-Proto`
headers and `client_max_body_size 25m;`). Keep `TRUST_PROXY=1` so the API sees real client addresses.

## 4. Health checks

| Endpoint | Meaning |
|---|---|
| `GET /api/v1/health` | Liveness: process up, database reachable. |
| `GET /api/v1/health/ready` | Readiness: database reachable, no unfinished migration, file storage writable. `503` otherwise. |

Both are used by the containers' Docker health checks and are suitable for an external uptime monitor.

## 5. Upgrading to a new version

1. Read the release notes in `docs/IMPLEMENTATION_PLAN.md`.
2. **Back up first** and verify the backup (OPERATIONS.md §2):
   `COMPOSE_FILE=docker-compose.prod.yml DB_SERVICE=db STORAGE_SERVICE=api ENV_FILE=.env.production scripts/backup.sh`
3. `git pull`, set `APP_VERSION` in `.env.production` to the new version.
4. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
   — the API applies new migrations automatically on start (set `SKIP_MIGRATIONS=true` to run them as a separate step).
5. Check `ps` shows all services healthy and sign in.

**Rolling back:** migrations are forward-only. Restore the backup taken in step 2 (`scripts/restore.sh`)
and start the previous image tag (`APP_VERSION=<previous>`).

## 6. Running without Docker

Node 20.10+ and PostgreSQL 16:

```bash
npm ci && npm run build:shared
npm run build -w @vcms/api && (cd apps/api && npx prisma migrate deploy)
NEXT_OUTPUT=standalone API_URL=http://127.0.0.1:4000 npm run build -w @vcms/web
NODE_ENV=production node apps/api/dist/main.js                      # with the environment variables above
NODE_ENV=production PORT=3000 node apps/web/.next/standalone/apps/web/server.js
```

Copy `apps/web/.next/static` to `apps/web/.next/standalone/apps/web/.next/static` and `apps/web/public` to
`apps/web/.next/standalone/apps/web/public` after building. Run both under a process manager (systemd).

## 6a. WhatsApp (each clinic's own number)

Clinics connect their own WhatsApp Business number in **Settings → Integrations → WhatsApp** (staff with
`integrations.manage`): Phone number ID, WhatsApp Business Account ID, a permanent System User token and the
Meta app secret. The token and secret are stored encrypted with `ENCRYPTION_KEY`.

- The API calls `https://graph.facebook.com` (override with `WHATSAPP_GRAPH_URL`; version `WHATSAPP_API_VERSION`,
  default `v21.0`), so the server needs outbound HTTPS.
- Meta must reach the webhook shown on the settings page: `https://<clinic address>/api/v1/webhooks/whatsapp/<key>`.
  It goes through the web server like every `/api` call, so it works wherever the clinic's address is public over
  HTTPS. Delivery receipts, read receipts, failures and clients' replies arrive there; calls are checked against
  the app secret (`X-Hub-Signature-256`).
- Messages that start a conversation need a Meta-approved template; the settings page links one to each kind of
  message and chooses which value fills each `{{1}}`, `{{2}}`…

## 7. What this release does not include

- **Offline / desktop mode.** The application needs a network connection to the server. Offline field
  visits and a desktop build are planned, not implemented.
- **Electronic integrations** with SMS providers, payment gateways, insurers or lab analysers (WhatsApp is included, §6a).
  Email is the only delivery channel that works out of the box.
- **High availability.** The compose stack is a single host. For multiple hosts, use a managed PostgreSQL
  service and an object-storage adapter for uploaded files (the storage layer is behind an interface).

## 8. Hosting many clinics (multi-clinic mode)

One installation can host many clinics. Each clinic gets **its own PostgreSQL database** and its own web
address, `https://<clinic>.<your domain>`. A super admin adds clinics at `https://admin.<your domain>`;
adding a clinic creates its database, applies every migration and sets up the clinic (main branch, roles,
owner account, starter price list) automatically, usually within a minute. Without `BASE_DOMAIN` the
installation works exactly as described above (one database, `ALLOW_SIGNUP` for the first organisation).

| Address | What it is | Database |
|---|---|---|
| `admin.<domain>` | Super admin: add, pause and reactivate clinics; new owner password | platform database (`DATABASE_URL`) |
| `<clinic>.<domain>` | One clinic's whole system | `vcms_t_<clinic>` (hyphens become `_`) |
| `<domain>`, `www.<domain>` | "Find your clinic" page only | — |

**Settings** (`.env.production`, then rebuild the web image — these are build arguments there):

| Variable | Purpose |
|---|---|
| `BASE_DOMAIN` | e.g. `nextcore.net.au`. Switches multi-clinic mode on. |
| `PLATFORM_SUBDOMAIN` | Super admin address (default `admin`). |
| `DB_NAME` | Use `vcms_platform` for a new installation: the platform database holds the list of clinics and the super admin accounts, never clinic data. |
| `APP_URL` | `https://<domain>`. Clinic links in emails keep its scheme and port and use the clinic's subdomain. |
| `TENANT_DB_PREFIX`, `TENANT_DB_POOL` | Clinic database name prefix (`vcms_t_`) and connections per clinic database per API process (`5`). |

Clinic databases are created on the same PostgreSQL server as `DATABASE_URL`, so that database user needs
the `CREATEDB` privilege (the compose stack's `vcms` user has it). Plan PostgreSQL's `max_connections` for
`clinics in use × TENANT_DB_POOL` per API process; idle clinic connections close after 10 minutes.

**DNS and HTTPS.** Point both `<domain>` and `*.<domain>` at the server, and use a wildcard certificate. With
Caddy and a DNS provider plugin (wildcard certificates need the DNS challenge):

```
nextcore.net.au, *.nextcore.net.au {
    tls { dns cloudflare {env.CF_API_TOKEN} }
    encode gzip
    reverse_proxy 127.0.0.1:3000
    request_body {
        max_size 25MB
    }
}
```

With nginx use `server_name nextcore.net.au .nextcore.net.au;` and keep the original host:
`proxy_set_header Host $host;`. The web server passes the address the browser used to the API, which picks
the clinic database from it.

**First super admin.** After the stack is up:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  node dist/cli/platform.js create-admin --email you@nextcore.net.au --name "Your Name"
```

It prints a temporary password once; sign in at `https://admin.<domain>` and choose your own password.
Then use **Add clinic**. The owner gets either a temporary password (shown once to you) or an invitation
email, and signs in at the clinic's own address. **New owner password** in a clinic's menu helps when the
owner is locked out or the invitation did not arrive. **Pause clinic** stops all sign-ins and requests to
that clinic without deleting anything; **Reactivate** undoes it.

**Moving an existing installation to multi-clinic mode.** Create an empty platform database
(`createdb -U vcms vcms_platform`), set `DB_NAME=vcms_platform` and `BASE_DOMAIN`, rebuild and start, create
a super admin, then host the existing database under an address:

```bash
docker compose … exec api node dist/cli/platform.js add-existing --address mainclinic --database vcms
```

**Plans.** The super admin chooses, per clinic, what it may use. Open **Plans** to define them (three starter
plans are created the first time: Starter, Clinic, Hospital) and a clinic's own page to choose its plan.

- A plan sets: how many staff accounts and branches (or no limit), which of **Lab & X-ray, Hospital, Surgery,
  Livestock, Boarding, Insurance, Reports and Branding** are included, a monthly price (for your reference;
  billing is outside the app), and whether it can be chosen for new clinics. Everyday work (clients, patients,
  appointments, consultations, billing, pharmacy, stock, shop counter, vaccinations) is in every plan.
- A clinic can also get **exceptions**: its own staff or branch limit, features added or taken away.
- Changes apply within seconds, without the clinic signing in again. Editing a plan changes every clinic on it.
- Staff accounts counted: active and invited people; branches counted: active ones. Paused ones do not count.
- Nobody is ever removed or locked out by a lower limit: a clinic above it keeps what it has but cannot add more.
- Clinics added before plans existed, and clinics set to "No plan", have no limits.
- The owner sees the plan, usage and what is locked under **Settings → Your plan**.
- Plans live in the platform database. Without `BASE_DOMAIN` there are no plans and nothing is limited.

**Upgrades** update the platform database and every clinic database on API start
(`node dist/cli/platform.js migrate`, which you can also run by hand). A clinic whose update fails is
reported and the others continue; the command exits non-zero.

**Backups** must cover every database: use `scripts/backup-all.sh` (same variables as `backup.sh`, with
`DB_NAME=vcms_platform`). It writes the platform database and uploaded files to `backups/vcms-<time>` and
each clinic database to `backups/clinics/<database>/vcms-<time>`. Verify or restore one clinic with
`DB_NAME=<clinic database> scripts/verify-backup.sh …` / `scripts/restore.sh …`; a clinic backup holds its
database only, so restoring it leaves uploaded files untouched.

**Not included yet:** deleting a clinic and its database (deliberately manual: back it up, `dropdb`, then
remove its row from `"Tenant"` in the platform database), changing a clinic's address, per-clinic billing
or usage limits, and custom domains per clinic.
