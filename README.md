# NextCore VCMS — Veterinary Clinic Management System

Multi-tenant practice management for companion-animal clinics, hospitals and farm/livestock practices (initial markets: Pakistan and Australia).

- **apps/api** — NestJS 10 REST API (`/api/v1`, OpenAPI at `/api/docs`), Prisma 5, PostgreSQL 16
- **apps/web** — Next.js 15 (App Router), React 19, Tailwind, TanStack Query
- **packages/shared** — permission catalogue, Zod schemas, money helpers (used by API and web)

Product scope and rules: [`context.md`](context.md). Status: [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md). Plan: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Documentation

| Document | For |
|---|---|
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Installing and upgrading a production server (Docker, HTTPS, health checks) |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Backups and restore, monitoring, secrets, routine tasks, incident response |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security controls, the tests that cover them, dependency review, known limitations |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | Personal data held, client data export and anonymisation, retention |
| [`docs/UAT_CHECKLIST.md`](docs/UAT_CHECKLIST.md) | Acceptance testing by clinic staff before go-live |
| [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md) | Data model, integrity triggers and constraints |

## Quick start (development)

Requirements: Node 20.10+, Docker.

```bash
npm install
docker compose up -d postgres mailpit           # Postgres on :5433, Mailpit UI on http://localhost:8025
cp apps/api/.env.example apps/api/.env           # then set SESSION_SECRET and ENCRYPTION_KEY:
#   openssl rand -hex 32   (use one value for each)
npm run build:shared
npm run db:deploy -w @vcms/api                   # apply migrations
npm run db:seed                                  # DEMO data (clearly labelled), optional

npm run dev:api                                  # http://localhost:4000/api/v1  (docs: /api/docs)
npm run dev:web                                  # http://localhost:3000
```

Demo accounts (seed only — password `DemoVet2026!`):

| Organization | Accounts |
|---|---|
| NextCore Veterinary Hospital (Demo) — Pakistan | owner@, manager@, vet@, vet2@, nurse@, reception@, lab@, pharmacy@, surgeon@, ward@, inventory@, accounts@, farmvet@ **demo.pk** |
| Harbourside Vet Clinic (Demo) — Australia | owner@, vet@, nurse@, reception@ **demo.au** |

Emails (invitations, password resets) are captured by Mailpit at http://localhost:8025.

## Production

Production runs as Docker containers (`docker-compose.prod.yml`: PostgreSQL, API, web) behind an HTTPS reverse proxy.
Copy `.env.production.example` to `.env.production`, fill in every value, then follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
The API refuses to start in production with placeholder secrets or insecure cookies. Schedule the backup and
restore-verification scripts in `scripts/` as described in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

CI (`.github/workflows/ci.yml`) runs lint, type checks, unit and integration tests, the Playwright suite, a
production dependency audit and the Docker image builds.

## Tests

```bash
npm test -w @vcms/shared                         # unit
npm test -w @vcms/api                            # API integration tests (uses the vcms_test database)
# E2E: with API + web running and demo data seeded
npm run test:e2e -w @vcms/web
npm run lint && npm run typecheck
scripts/test-backup-restore.sh                   # backup → verify → restore on a disposable production stack (Docker)
```

## Database migrations

```bash
cd apps/api
npx prisma migrate dev --create-only --name <change>   # author a migration (review the SQL)
npx prisma migrate deploy                              # apply
```
Never edit an applied migration; add a new one.

## Security notes

- Sessions: opaque random token in an HttpOnly, SameSite=Lax cookie; SHA-256 hash stored server-side; idle and absolute expiry; revocable.
- CSRF: double-submit token (`vcms_csrf` cookie → `X-CSRF-Token` header) plus Origin check on state-changing requests.
- Authorization is enforced by the API on every route (`@RequirePermissions`); tenant isolation is enforced in the Prisma data-access layer and covered by tests.
- Serve over HTTPS in any non-local deployment; `COOKIE_SECURE` defaults to `true` when `NODE_ENV=production`.
- Secrets live only in environment variables; `.env*` files are git-ignored and excluded from Docker builds.
- Full details: [`docs/SECURITY.md`](docs/SECURITY.md).
