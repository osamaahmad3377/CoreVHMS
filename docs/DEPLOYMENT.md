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

## 7. What this release does not include

- **Offline / desktop mode.** The application needs a network connection to the server. Offline field
  visits and a desktop build are planned, not implemented.
- **Electronic integrations** with SMS/WhatsApp providers, payment gateways, insurers or lab analysers.
  Email is the only delivery channel that works out of the box.
- **High availability.** The compose stack is a single host. For multiple hosts, use a managed PostgreSQL
  service and an object-storage adapter for uploaded files (the storage layer is behind an interface).
