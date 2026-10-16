# Security

Controls built into NextCore VCMS, how they are tested, the dependency review, and known limitations.
Last review: 2026-10-15 (Milestone 10).

## 1. Controls

### Identity and sessions
- Passwords hashed with **Argon2id** (memory 19 MiB, 2 iterations — OWASP baseline). Policy: 10–128 characters, upper- and lower-case letters and a digit.
- **Account lockout**: 5 failed sign-ins lock the account for 15 minutes. Failed attempts and lockouts are audited. Sign-in answers do not reveal whether an account exists.
- **Rate limits** on sign-in, password reset, invitation acceptance and MFA (10/min; 5 per 15 min or per hour on the most sensitive), plus a general per-session limit.
- **Optional TOTP multi-factor authentication** with single-use recovery codes. MFA secrets are encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`).
- **Sessions** are random opaque tokens. Only their SHA-256 hash is stored. Sessions have idle and absolute expiry (8 h / 7 days by default), are listed per user, can be revoked individually, and are all revoked on password reset or when an account is suspended.
- Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` in production (the API refuses to start without it).
- **Temporary passwords** (staff added without email): generated server-side (16 characters from an unambiguous alphabet, about 90 bits), shown once to the administrator and never stored or logged in clear (Argon2id hash only). Until the user chooses their own password, every API route except loading the session, signing out and changing the password returns `403 PASSWORD_CHANGE_REQUIRED`. Unused temporary passwords expire after 7 days. Issuing one for an existing member is refused for accounts also used at another organization, for platform administrators, for yourself, and for members whose roles you could not assign; it revokes the person's sessions and pending reset links. Accounts that already exist can only join by invitation, so their password is never replaced.

### Requests
- **CSRF**: double-submit token (`vcms_csrf` cookie → `X-CSRF-Token` header) on every state-changing request, plus an **Origin check** that rejects cross-site requests even with a valid token.
- **Authorization on every route.** Each API route declares whether it is public, needs only a signed-in user, or which permissions it requires. An automated test fails the build if any route declares nothing (`test/route-audit.int-spec.ts`), and another test calls every GET route without a session and expects `401` (143 routes).
- **Tenant isolation** in the data-access layer: every query on organisation-owned data is scoped automatically; foreign keys supplied by users are validated as belonging to the same organisation. Cross-tenant tests exist for every module (including `tenancy.int-spec.ts`), and `tenancy-sweep.int-spec.ts` calls every parameterised GET route as another clinic with ids from one sample record of every organisation-owned table, failing if any response contains that clinic's data.
- **Input validation** with Zod schemas shared by API and forms; IDs are validated as UUIDs and page sizes capped before reaching the database. All database access is parameterised (Prisma; the few raw queries use tagged templates).
- **Uploads**: allow-listed MIME types, magic-number checks for binary types, size limit (`MAX_UPLOAD_MB`), stored outside the web root under random keys, served with `nosniff` and `Content-Disposition`, every download audited.
- **Output**: React escapes all rendered text. CSV exports (clients, reports, statements, audit log) neutralise spreadsheet formulas (CSV injection).

### Transport and headers
- HTTPS terminated at the reverse proxy; `Strict-Transport-Security` sent by the web app in production.
- Web: `Content-Security-Policy` (only own-origin resources, no framing, no plugins), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- API: Helmet defaults; `X-Powered-By` removed. Swagger UI is off in production unless `API_DOCS=true`.

### Data integrity and audit
- **Audit trail** of sign-ins, record views (`patient.viewed`), changes (with before/after values), every data export (client list, client statement, report CSVs, client data export, audit log) and administrative actions, written in the same database transaction as the change. Audit rows are append-only (database trigger). The log is filterable and exportable as CSV (and the export itself is audited).
- Signed clinical records, completed treatments, movements, care logs and similar records are protected by **database triggers** against edits/deletion (amend, void or addendum instead).
- Money in integer minor units; idempotency keys on payments; row locks on stock and invoice updates.

### Secrets and configuration
- Secrets only in environment variables (`.env*` git-ignored, excluded from Docker build context).
- In production the API **refuses to start** with placeholder secrets, the development database password or insecure cookies (`test/security.int-spec.ts`).
- Containers run as an unprivileged user; the database is not exposed outside the Docker network.

### Privacy
- Per-client data export and anonymisation on request, with permission `privacy.manage` and audit entries (see PRIVACY.md).

## 2. Tests that cover security

| Area | Where |
|---|---|
| Sign-in, lockout, CSRF, logout, password reset, MFA, staff suspension, audit append-only | `apps/api/test/auth.int-spec.ts` |
| Temporary passwords: forced change, expiry, existing-account and shared-account refusals, permissions | `apps/api/test/temporary-password.int-spec.ts`; browser `apps/web/e2e/temporary-password.spec.ts` |
| Every route declares access rules | `apps/api/test/route-audit.int-spec.ts` |
| No GET route answers without a session; cookie flags; security headers; cross-origin rejection; injection-style input; readiness; production configuration guard; audit CSV export | `apps/api/test/security.int-spec.ts` |
| Role permissions per module | `apps/api/test/permissions.int-spec.ts` and each module's suite |
| Tenant isolation | `apps/api/test/tenancy.int-spec.ts`, the route-by-route sweep in `apps/api/test/tenancy-sweep.int-spec.ts`, and each module's suite |
| Upload validation | `apps/api/test/patients.int-spec.ts` (attachments) |
| Client data export / anonymisation | `apps/api/test/privacy.int-spec.ts`; in the browser `apps/web/e2e/privacy-audit.spec.ts` |
| Every data export is audited (client list, statement, report CSV, client data, audit log) | `apps/api/test/security.int-spec.ts` |
| Backup, verification, corrupted-backup rejection and restore on the production images | `scripts/test-backup-restore.sh` (CI job "Docker images, backup and restore test") |
| Browser: access control in the UI | `apps/web/e2e/clients-patients.spec.ts` |

## 3. Dependency review (2026-10-15)

`npm audit --omit=dev` started at **26 findings (1 critical, 14 high)**. Actions:

- **Next.js 14.2.35 → 15.5.28 and React 18 → 19**: the 14.x line no longer receives fixes; this resolved the critical image-optimisation remote-code-execution advisory and the high-severity server-component/rewrite advisories. All web tests were re-run on the new versions.
- **Nodemailer 6 → 10** (address-parser DoS, SMTP command injection advisories).
- **NestJS 10.4.22** (latest 10.x) and patched transitive packages pinned with `overrides`: multer 2.4.0, body-parser 1.20.8, lodash 4.18.1, js-yaml 4.3.2, uuid 11.1.1, qs 6.16.1, postcss 8.5.30, picomatch 4.0.4+.
- `tailwindcss-animate` moved to build-time dependencies (Tailwind's file-watching dependencies are not part of the running application).

Result: **0 critical, 0 high**. Remaining moderate findings, reviewed and accepted:

| Advisory | Package | Why it does not affect this application | Plan |
|---|---|---|---|
| GHSA-36xv-jgw5-4q75 | @nestjs/core ≤ 11.1.17 | Affects Server-Sent Events (`@Sse`) only; the application has no SSE endpoints. | Upgrade to NestJS 11 in the next maintenance release. |
| GHSA-5v7r-6r5c-r473, GHSA-j47w-4g3g-c36v | file-type 20.x (inside @nestjs/common) | Used only by Nest's `FileTypeValidator`, which the application does not use (uploads use our own allow-list and magic-number checks). | Resolved by the NestJS 11 upgrade. |

CI runs `npm audit --omit=dev --audit-level=high` and fails on any new high or critical advisory.

## 4. Known limitations
- `script-src 'unsafe-inline'` is required by Next.js's inline bootstrap scripts; a nonce-based CSP would remove it.
- `ENCRYPTION_KEY` rotation (re-encrypting MFA secrets) is not automated — see OPERATIONS.md §5.
- No built-in web application firewall or IP allow-listing; use the reverse proxy or hosting provider for these if required.
- An external penetration test has not been performed. Recommended before go-live with real client data.

## 5. Reporting a vulnerability
Report suspected vulnerabilities privately to the system owner (not in public issue trackers), with steps to
reproduce and the `x-request-id` of any affected request. See OPERATIONS.md §7 for the incident procedure.
