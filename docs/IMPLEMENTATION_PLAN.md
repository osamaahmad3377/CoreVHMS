# Implementation Plan — NextCore VCMS

Living document. Update the **Progress log** at the end of each milestone.

## 1. Architecture

```
COREVET/
├── apps/
│   ├── api/        NestJS 10 REST API (/api/v1), Prisma 5, PostgreSQL 16
│   └── web/        Next.js 14 App Router UI (staff app; client portal kept but switched off)
├── packages/
│   └── shared/     Zod schemas, permission catalogue, enums, money/units helpers
├── docs/           Audit, plan, feature matrix, database design
└── docker-compose.yml   postgres (dev + test DBs), mailpit (SMTP catcher)
```

### Request flow
Browser → Next.js (`:3000`) → rewrite `/api/*` → NestJS (`:4000`). The browser only ever talks to one origin, so session cookies are first-party and `SameSite=Lax` works without CORS.

### Backend layers (per module)
- `*.controller.ts` — HTTP only: route, permission decorator, Zod validation, response shape.
- `*.service.ts` — business rules and transactions. No HTTP types.
- `PrismaService` — tenant-scoped client. Every model listed in `TENANT_MODELS` has `organizationId` injected into `where`/`data` from the request context (AsyncLocalStorage). Cross-tenant access is impossible through this client; system jobs use an explicit `unscoped` client.
- `AuditService` — explicit audit events written in the same transaction as the change.

### Cross-cutting
| Concern | Decision |
|---|---|
| Validation | Zod schemas in `@vcms/shared`, used by both API (pipe) and web (React Hook Form resolver). |
| Errors | Global filter → `{ error: { code, message, details?, requestId } }`. |
| Pagination | `?page&pageSize&sort&q` → `{ data, meta: { page, pageSize, total } }`. |
| Auth | Opaque session tokens (SHA-256 hashed in DB), idle + absolute expiry, revocable. TOTP MFA optional. |
| Permissions | String keys (`clients.read`, `clinical.sign`, …) grouped by domain. System role templates per org; custom roles allowed. Guard enforces on server. |
| Branch scope | `X-Branch-Id` header; membership must grant that branch. |
| Numbering | `Counter` table, row-locked increment inside the creating transaction (client no., patient no., invoice no.). |
| Money | Integer minor units (`BigInt`/`Int` cents/paisa) + ISO currency; no floats. |
| Time | Stored UTC (`timestamptz`); branch has IANA timezone for display and scheduling. |
| Files | `StorageAdapter` interface; local-disk implementation for dev; metadata in `Attachment` table; downloads go through an authorised endpoint. |
| Jobs | DB-backed outbox/job tables polled by `@nestjs/schedule` workers (no Redis dependency). Idempotency keys on notifications. |
| Integrations | Adapter interfaces (email, SMS, WhatsApp, payments, STT/AI, lab). Email uses SMTP → Mailpit in dev. Others ship as clearly labelled mocks until credentials exist. |

## 2. Milestones

| # | Milestone | Key deliverables |
|---|---|---|
| 1 | Foundation | Monorepo, Docker, Prisma schema + migrations, auth (login, sessions, reset, invite, MFA), roles/permissions, audit, tenant isolation, app shell, settings for org/branches/users/roles. |
| 2 | Clients & patients | Clients (individual/farm/business), contacts, patients, species/breeds, identifiers, weights, alerts/allergies, attachments, duplicate detection, merge, timeline, global search. |
| 3 | Appointments & clinical | Appointment types, resources, availability, calendar (day/week/resource), conflict prevention, check-in/queue/triage, encounters, SOAP notes, vitals, diagnoses, sign/amend workflow, templates. |
| 4 | Prescriptions & diagnostics | Medicine catalogue, prescriptions with authorisation, dosage calculator with sourced references, dispensing; lab test catalogue, orders, samples, results with reference intervals, imaging. |
| 5 | Inventory & finance | Products, batches, locations, stock ledger, FEFO, procurement (PR→PO→GRN), services/price lists, estimates, invoices, payments, refunds/credit notes, POS, cash register, reports. |
| 6 | Hospital & surgery | Wards/cages, admissions, flowboard, treatment sheets, observations, surgery scheduling, checklists, anaesthesia monitoring, discharge. |
| 7 | Communications & portal | Reminder engine, notification templates, delivery log, email/SMS/WhatsApp adapters, client portal. |
| 8 | Livestock & additional | Farms/herds/flocks, breeding, production, withdrawal periods, field visits, boarding, grooming, insurance, referrals. |
| 9 | AI & advanced | AI SOAP draft (human approval), STT adapter, analytics. |
| 10 | Production readiness | Security review, backup/restore scripts + tests, CI, deployment docs. |

## 3. Dependencies between milestones
- M3 depends on M2 (patients) and M1 (staff/branches).
- M4 prescriptions depend on M5 products for stock deduction → the product catalogue is introduced in M4 and extended in M5.
- Billing (M5) hooks into encounters, prescriptions, lab orders and hospital stays via a single `ChargeCapture` service so charges are created once.
- M7 reminders depend on preventive care (vaccination records from M3/M4).

## 4. Risks
See `PROJECT_AUDIT.md §3`. Additional: Docker Desktop memory (7.6 GiB) is sufficient for Postgres + dev servers; Next.js production builds are run at milestone ends only.

## 5. Progress log
_(updated at the end of each milestone)_

### 2026-10-14 — Milestones 1 & 2 complete
- **Foundation:** npm-workspace monorepo, Docker (Postgres 16 + Mailpit), Prisma schema + migration `init` (tenancy, identity, audit, counters, species, clients, patients, attachments; pg_trgm indexes; append-only audit trigger; single-current-owner partial index).
- **Security:** opaque hashed sessions, CSRF double-submit + Origin check, Argon2id, lockout, throttling, TOTP MFA with recovery codes, invitations, password reset, session management, escalation-safe custom roles, tenant-scoping Prisma extension.
- **Clients & patients:** full CRUD, duplicate detection, merges via step registries, ownership history, alerts, weights, identifiers, timeline registry, secure attachments, global search, dashboard widget registry.
- **Web:** design system, permission-aware shell, ⌘K search, auth screens, dashboard, clients, patients, settings (org, branches, staff, roles, species), audit log, account security.
- **Tests executed:** shared 15/15, API integration 33/33, Playwright E2E 4/4; ESLint clean (api, web); `tsc` clean (api, web, shared).
- **Known limitations:** client balance is a placeholder until billing; no rosters yet; email sent synchronously (outbox/jobs in M7); offline mode not started.

### 2026-10-14 — Milestone 3 complete (appointments & clinical workflows)
- **Schema:** migrations `scheduling_clinical` and `note_immutability_refine` (appointment types, resources, rosters, leave, appointments + resource bookings with GiST exclusion constraints, waitlist, triage, encounters, versioned SOAP notes with immutability trigger, vitals, vital references, diagnoses, problem list, templates, tasks).
- **API:** scheduling module (config, booking with roster/leave/overlap checks and audited overrides, recurring series, reschedule, status workflow, availability, front-desk queue, walk-ins, triage, waitlist) and clinical module (encounters, notes draft/review/sign/amend/verify/discard, vitals with sourced reference flags, diagnoses, problems, templates, tasks). Registered timeline/merge/dashboard/attachment integrations. Session-aware rate limiting (per session, not per clinic IP).
- **Web:** calendar (day/week), front desk board, consultations list + workspace, rosters & leave, settings for appointment types, rooms, templates, vital references; patient record gains Book/Consult/Triage, consultations & appointments tabs, problem list; dashboard clinical widgets.
- **Tests executed:** shared 15/15, API 59/59 (5 unit + 54 integration), Playwright 6/6; lint and typecheck clean.
- **Known limitations:** no month view or drag-and-drop rescheduling; waitlist has API only (no UI yet); no appointment reminders until M7; no billing hooks until M5; encounter type mapping from appointment categories is basic.
- **Next (Milestone 4):** product/medicine catalogue (shared with inventory), prescriptions with authorisation and sourced dose references, dispensing, laboratory test catalogue, orders, samples, results with reference intervals, imaging records.

### 2026-10-14 — Milestone 4 complete (prescriptions, pharmacy, laboratory & imaging)
- **Schema:** migration `pharmacy_lab` with triggers freezing authorised prescription items and final lab results, plus quantity CHECK constraints.
- **Shared:** `calculateDose` / `compareToRange` / `courseQuantity` (pure arithmetic, unit-tested; no clinical values).
- **API:** pharmacy module (formulary, withdrawal periods, dose references with vet approval, evaluate/create/authorise/dispense/cancel/repeat/verify prescriptions, administrations, withdrawal tracking, dispense & administration hooks for inventory) and lab module (catalogue, reference intervals, orders, samples & chain of custody, results with flags/critical tasks, imaging reports, release, amendments, barcode search). Registered timeline, merge, dashboard and attachment integrations.
- **Safety decisions:** no dose, withdrawal or reference-interval values are shipped; blocking warnings require a documented override reason; critical limits fall back to broader intervals so alerts are never lost; nurse role may draft prescriptions, only `prescriptions.authorize` holders authorise; pharmacy role gains `formulary.manage` (approval still needs `clinical.sign`).
- **Web:** prescription builder with live calculation, pharmacy worklist & detail (authorise, dispense, labels, repeat, integrity check), formulary & product pages, administration dialog, withdrawal banner, lab worklist, order detail (samples, result grid with live flags, imaging report, release, amend, printable report & sample labels), test catalogue editor, consultation & patient panels, dashboard widgets.
- **Tests executed:** shared 22/22, API 76/76, Playwright 8/8; lint and typecheck clean.
- **Known limitations:** no drug-interaction checking (needs a licensed data source); no stock deduction until M5 (hooks in place); no analyser/PACS integration; no controlled-drug register report yet (M5 with stock ledger); label printing uses the browser print dialog.
- **Next (Milestone 5):** inventory (locations, batches, stock ledger, FEFO, counts, adjustments), procurement (PR → PO → GRN), services & price lists, estimates, invoices with automatic charge capture from consultations/prescriptions/lab, payments, refunds, POS, cash register, financial reports.

### 2026-10-14 — Milestone 5 complete (inventory, procurement, billing, POS, reports)
- **Schema:** migration `inventory_finance` (locations, batches, levels, append-only ledger, counts, suppliers, purchase orders, goods receipts, tax rates, services, charges, invoices, payments/allocations, refunds, credit notes, estimates, cash registers/sessions, expenses) with immutability triggers, positive-amount CHECKs and one-open-session index.
- **API:** inventory (stock engine with row locks and FEFO, receipts with weighted cost, adjustments, transfers, batch status, counts, ledger, controlled register, stock settings incl. product tax rate), procurement (suppliers, POs with approver ≠ creator, reorder suggestions), billing (config, charge capture via dispense/administration/lab/encounter hooks, invoices, payments, refunds, credit notes, voids, statements, cash, estimates, expenses), reports. Dashboard, timeline, search and merge integrations registered.
- **Fixes found while testing:** COGS now nets out client returns (voided sales were counted as cost); appointment-type `serviceId` was silently dropped; a typed batch number not in stock was replaced by FEFO without trace (now rejected, and issued batches are written back to dispensing/administration records); invoices due on issue showed as overdue immediately (due date now ends at local midnight); finance widget "today" used server time (now branch timezone); POS-only users could post custom prices (now 403).
- **Web:** inventory (stock overview, product stock & batches with adjust/transfer/quarantine/recall, ledger, counts, purchase orders, suppliers, controlled register, locations), billing (invoices, builder, detail with payment/credit note/void/print, unbilled charges, payments & refunds, estimates, cash registers, expenses), POS, reports with CSV, client Account tab, settings (services & fees, billing & tax, billed service on appointment types), dashboard finance & inventory widgets; nav items enabled.
- **Seed:** locations, opening stock (demo quantities, one low and one near-expiry item), supplier, services linked to appointment types, cash register with an open session, consultation charges, one part-paid invoice. AU uses GST 10% with tax-inclusive prices; the PK demo uses a clearly labelled 0% rate because provincial sales tax must be set by the practice.
- **Tests executed:** shared 27/27, API 92/92 (10 unit + 82 integration), Playwright 10/10; ESLint and `tsc` clean (api, web, shared).
- **Known limitations:** no payment-gateway or accounting-software integration; purchase requests and supplier-return workflow not built (returns via adjustment reason); one open cash session per branch is used for cash (multiple simultaneous registers per branch pick the latest); expenses list shows the latest 500; reports are fixed (no custom builder); stock valuation is at batch cost, not FIFO layers.
- **Next (Milestone 6):** hospitalisation (wards/cages, admissions, flowboard, treatment sheets with scheduled administrations, nursing observations, discharge) and surgery & anaesthesia (scheduling, checklists, anaesthesia monitoring), with charges captured through the existing billing hooks.

### 2026-10-15 — Point of sale upgrade
- **API:** `GET /pos/catalog` (sellable products and services with tax, usable stock at the branch's default location, barcode/SKU/code exact match, prescription flags) and `GET /pos/recent` (today's counter sales at the branch, branch timezone). Counter sales now also refuse prescription vaccines.
- **Web:** POS rebuilt: item grid with categories and stock, scanner-friendly search, basket with steppers and authorised price/discount edits, split tender with quick cash and change, held baskets (device-local), thermal receipt with print/reprint, today's sales, register status, keyboard shortcuts.
- **Tests executed:** API 93/93, Playwright 11/11; lint and typecheck clean.

### 2026-10-15 — Ease-of-use pass
- **API:** `GET /setup/status` (onboarding module): ten setup steps computed from live configuration (profile, team, rosters, appointment types, services + tax, service links, priced products, stock location, cash register, first client); administrators only.
- **Web:** dashboard quick actions per role and a setup checklist for administrators; Help centre (`/help`) with task guides for every module, search, "for my role" filter, glossary of terms and keyboard shortcuts; "How to" links on main pages; `?` shortcuts dialog; Help button in the top bar; "New" menu gains counter sale, new invoice and receive stock.
- **Tests executed:** API 94/94, Playwright 12/12; lint and typecheck clean.

### 2026-10-15 — Milestone 6 complete (hospitalisation, surgery & anaesthesia)
- **Schema:** migration `hospital_surgery` (wards, cages, admissions, treatment orders/tasks, hospital notes, surgeries, team, anaesthesia readings, surgery items, addenda, checklist template; `VitalSign.admissionId`; `TaskType.HOSPITAL_ALERT`) with occupancy partial unique indexes, CHECK constraints and locking/append-only triggers.
- **API:** hospital module — wards/cages, admissions (admit, flowboard, move, notes, escalate, discharge, cancel, patient status), treatment sheet (orders, scheduled task generation, record/skip with concurrency guard, give-now, stop), observations via vitals, daily charges (idempotent) and an hourly upkeep job; surgery — schedule via appointments, pre-op, consent, checklist template and ticks, team, transitions with gates, readings, consumables (stock + charge), completion fee and follow-up task, addenda. Timeline, merge, search (HOSP-/SURG-), dashboard and attachment integrations. Administrations gained an in-transaction callback; vitals can be linked to a stay.
- **Fixes found while testing:** surgical report text typed into a form was lost on background refresh (now only unedited fields refresh).
- **Web:** hospital flowboard, stay page (treatment sheet with due-now list and 24 h grid, observations with trends, notes/handover, details, documents, move/escalate/discharge/cancel, printable discharge summary), surgery list and record (stepper, pre-op & consent, safety checklist, anaesthesia monitoring & drugs, procedure & consumables, recovery & post-op, team, documents, addenda, printable report), settings for wards & cages and the surgical checklist, patient banner status chip and Admit/Surgery buttons, dashboard widgets, quick actions, help guides.
- **Seed:** wards and cages per demo clinic with daily-rate services, one inpatient with a populated treatment sheet, observations and handover, and one surgery booked for today with consent recorded.
- **Tests executed:** shared 27/27, API 104/104 (10 unit + 94 integration), Playwright 14/14; ESLint and `tsc` clean; Next.js production build succeeds.
- **Known limitations:** no anaesthesia monitor or infusion pump integration; treatment orders cannot be edited (stop and re-order); daily fees are per started 24 h (not per calendar night); a stay's encounter is optional, so hospital medication is linked to the patient rather than a consultation unless admitted from one.
- **Next (Milestone 7):** reminders engine (vaccinations, rechecks), notification templates, email/SMS/WhatsApp adapters with delivery log, vaccination records and certificates, client portal.

### 2026-10-15 — Milestone 7 complete (preventive care, communications, client portal)
- **Schema:** migration `preventive_comms_portal` (care protocols and items, message templates, outbound message queue/log, client messages, portal users/accesses/sessions/tokens, appointment requests, attachment sharing, appointment reminder stamp, organisation reminder/portal settings) with partial unique index, CHECKs and locking triggers.
- **API:** preventive module (protocols with source + vet approval, care plans, completion via pharmacy, auto-completion hook, defer/cancel, worklist, certificate, compliance, manual reminder); comms module (templates, queue with dedupe, dispatcher with back-off/SKIP LOCKED/rate limit, email adapter, explicit "not configured" SMS/WhatsApp adapters, hourly reminder generation, staff inbox and replies, settings); portal module (separate auth with invite/accept/forgot/reset/lockout/switch, portal guard with own CSRF, scoped data endpoints, document download of shared files only, appointment cancel within notice and requests, staff invite/revoke and request decisions). Staff auth guard skips portal routes. Attachments gained sharing.
- **Fixes found while testing:** accepting an invitation didn't record the sign-in time; the demo reset left portal logins of non-demo emails behind (orphans are now removed).
- **Web:** Preventive care page (due & overdue, protocols with approval and apply-to-all, compliance), patient Care plan tab and printable certificate page, Communications page (message log with channel status, client message inbox, appointment requests → calendar booking), client Communication tab and portal card, Messages & reminders settings, document share toggle, dashboard widgets, help guides; client portal (`/portal`): sign-in/invitation/reset, home, animals with care, results, aftercare, medicines and documents, certificate, lab report, appointments with requests and cancellation, invoices, messages and feedback, settings — mobile-first with a bottom tab bar.
- **Seed:** demo protocols (labelled DEMO), care plans with due/overdue/history, sent-message history, demo portal logins `client@demo.pk` / `client@demo.au` with a message thread and a pending request.
- **Tests executed:** shared 27/27, API 116/116 (10 unit + 106 integration), Playwright 17/17 (including invitation through real SMTP to Mailpit); ESLint and `tsc` clean; Next.js production build succeeds.
- **Known limitations:** no SMS/WhatsApp provider integrated (messages logged as not sent; email fallback for reminders); no online payments in the portal; portal shows released lab results, discharge/surgery aftercare, prescriptions and shared documents only (clinical notes are not shared); no marketing campaign tool yet; reminders run hourly (not real-time).
- **Next (Milestone 8):** livestock and farm management (herds/flocks, group treatments, breeding, production, withdrawal tracking views, field visits), boarding and grooming, insurance claims and referrals.

### 2026-10-15 — Client portal switched off (deferred)
- **Decision:** the client-facing side is not wanted yet; it stays in the codebase for a future release.
- **How:** new setting `CLIENT_PORTAL_ENABLED` (default `false`). When off the API does not load `PortalModule`, so all portal routes return 404: the client routes, plus the staff-side routes moved into the portal module (invitations, client-message inbox, appointment requests, sharing documents with a client). The staff session reports `features.clientPortal` and the web app hides the portal card, the secure-messages link, the Client messages and Appointment requests tabs, the dashboard portal tiles, the portal settings and templates, the online-booking option, the share-with-client button and the portal help guide. Next middleware redirects `/portal/*` to `/`. The demo seed skips portal logins, messages and requests. Merge hooks for portal records moved to the communications module so merges stay correct either way. Reminders, the message log and preventive care are unaffected.
- **To turn it on later:** set `CLIENT_PORTAL_ENABLED=true` in `apps/api/.env` and in the web app's environment, restart both, and reseed for demo portal logins.
- **Tests executed:** shared 27/27; API 117/117 (the portal suite switches the portal on for itself; a new test checks it is off by default); Playwright 16 passed, 2 skipped (the portal scenarios run only with the setting on), including a new check that the portal pages and controls are gone; web ESLint and `tsc` clean.

### 2026-10-15 — Milestone 8 complete (livestock & farms, boarding & grooming, insurance & referrals)
- **Schema:** migration `livestock_boarding_insurance` — farms, animal groups, movements, breeding events, production, group treatments, outbreaks, field visits and items; boarding units, stays, logs; grooming jobs and services; insurers, policies, pre-authorisations, claims (+ claim invoices), referral contacts, referrals; patient farm/group/sire/dam; species gestation (configurable, sourced); payment method INSURANCE. Integrity triggers and check constraints as listed in DATABASE_DESIGN.
- **API:** `livestock` (farms, groups, bulk registration, movements, withdrawal board, breeding, production, group treatments with stock/billing/withdrawal, outbreaks, field visits with billing, farm report, species gestation settings), `boarding` (units, availability, stays, check-in vaccination gate, logs, check-out billing; grooming board, jobs, services, transitions), `insurance` (insurers, policies, pre-auths, claims with insurer payments posted atomically via `PaymentsService.take(…, within)`, claim form data; referral contacts, referrals, letter, email through the outbound queue, clinical summary from signed records). All registered with timeline, merge, search, dashboard and attachment registries. Appointments expose linked grooming job / field visit.
- **Web:** Livestock & farms (overview, farms, visits, withdrawals, births due, outbreaks; farm page with groups, breeding, production chart, health, visits, report, movements, documents; group page with tag registration, movements, milk sheet, batch daily records; field visit sheet with invoice), patient Farm & breeding and Insurance & referrals tabs, client Farms card, Boarding & grooming (today, kennel chart, grooming board, bookings; stay and grooming pages), Insurance & referrals (claims, pre-auths, policies, referrals, insurers, specialists; claim page + printable form; referral page + printable letter), calendar shortcuts for grooming/field-visit appointments, Settings → Boarding units and Livestock (gestation), dashboard tiles, help guides. Nav items marked ready.
- **Seed:** demo farms with herds, a broiler batch with daily records, breeding/pregnancies (labelled demo gestation figures), milk records, an outbreak, field visits; kennels with a boarder and a booking; a grooming job; a demo insurer, policy, submitted claim, pre-auth, specialist and referral.
- **Fixes found while testing:** births-due count double-counted pregnancies (service + check); detail-page side columns overflowed with long one-line text (grid tracks now minmax(0,1fr)); kennel chart hid the name of stays that started before the visible week.
- **Tests executed:** shared 27/27; API 128/128 (21 suites, incl. 11 new Milestone 8 integration tests); Playwright 20 passed + 2 skipped (portal, switched off) on a fresh seed, incl. 4 new Milestone 8 scenarios; API and web ESLint/tsc clean; Next.js production build succeeds.
- **Known limitations:** no offline field-visit sync; no electronic insurer/claims integration (claims are prepared, printed and tracked); referral emails go through the email channel only; boarding extras (e.g. baths during a stay) are billed as grooming jobs or manual invoice lines; reproductive-state rules are deliberately simple (latest service/check/birth).
- **Next:** Milestone 9 (AI) is marked "not implemented yet" in the brief, so Milestone 10 — production readiness: security review, regression, backup/restore, Docker images for API and web, deployment and CI, documentation and UAT checklist.


### 2026-10-15 — Milestone 10 complete (production readiness)
Milestone 9 (AI) is deferred as stated in the brief ("will not be implemented yet").
- **Security review:** every API route now declares its access rule. The new `@Authenticated()` decorator marks the 9 routes that only need a signed-in user, and `route-audit.int-spec.ts` fails the build if any route declares nothing. A test calls every GET route without a session and expects 401. In production the API refuses to start with placeholder secrets, the development database password or insecure cookies (`productionProblems()` in `env.ts`); `COOKIE_SECURE` and `ALLOW_SIGNUP` default by `NODE_ENV`. Swagger is off in production unless `API_DOCS=true`. Web security headers (CSP, HSTS in production, frame and referrer policies). One shared CSV helper (`common/util/csv.ts`) neutralises spreadsheet formulas in every export; the client statement export did not do this before.
- **Dependency review:** Next.js 14 → 15.5 and React 18 → 19 (the 14.x line no longer receives fixes), Nodemailer 10, and patched transitive packages via root `overrides`. `npm audit --omit=dev` went from 1 critical and 14 high to 0 critical and 0 high; the remaining moderate advisories were reviewed and accepted (SECURITY.md §3).
- **Privacy:** permission `privacy.manage` (migration `privacy_and_ops`, granted to owner and practice manager). Client → Privacy → download all data (JSON) and anonymise on request. Modules contribute through `ClientPrivacyService.registerExport` / `registerAnonymise`. Clinical and financial records are kept; both actions are audited. The audit log can be exported as CSV, and the export is itself audited.
- **Operations:** JSON logs (`LOG_FORMAT=json`) and a request log with request ids (`x-request-id`), without bodies or query strings; `TRUST_PROXY`; `/health/ready` checks the database, migrations and storage. `scripts/backup.sh` (database dump, file archive, checksums, row counts), `verify-backup.sh` (restores into a temporary database and compares row counts) and `restore.sh` (needs `CONFIRM=restore`).
- **Packaging and CI:** multi-stage Docker images for the API (applies migrations on start, runs as an unprivileged user) and the web app (Next.js standalone); `docker-compose.prod.yml` and `.env.production.example`. GitHub Actions: lint, type checks, unit and integration tests, production `npm audit`, the Playwright suite, and Docker image builds.
- **Verified by hand:** the production compose stack with a trial configuration (all services healthy, migrations applied, CSP and HSTS present, no browser console errors); a backup → change → restore round trip; and verification rejecting a corrupted backup.
- **Documentation:** DEPLOYMENT.md, OPERATIONS.md, SECURITY.md, PRIVACY.md, UAT_CHECKLIST.md, and an updated README.
- **Fixes found during this milestone:** the API image lacked undeclared dependencies (`date-fns`, `date-fns-tz`, `multer`) and the runtime copy of workspace `node_modules`; the backup scripts' checksum lookup matched two lines; the statement CSV lacked formula neutralisation; the Jest timeout was raised to 20 s because one integration test exceeded the 5 s default when the machine was busy (it passes when run alone or in a quiet full run).
- **Tests executed:** shared 27/27; API 139/139 in 24 suites, including 11 new tests (route audit, 7 security, 3 privacy); Playwright 20 passed and 2 skipped (portal, switched off) on a fresh seed against the rebuilt API on Next.js 15; ESLint and `tsc` clean for API and web.
- **Known limitations:** no external penetration test yet; `script-src 'unsafe-inline'` remains (Next.js inline bootstrap); `ENCRYPTION_KEY` rotation is manual; off-site backup copies are configured by the operator (e.g. `rclone`); NestJS 11 upgrade planned for the next maintenance release.
- **Next:** user acceptance testing with clinic staff (UAT_CHECKLIST.md), then go-live. Later phases: client portal, SMS/WhatsApp providers, offline field use, AI note assistance (Milestone 9).

### 2026-10-16 — Milestone 10 follow-up (test gaps closed)
- **Backup and restore tested automatically:** `scripts/test-backup-restore.sh` runs the real scripts against a disposable copy of the production stack: backup, verification, a corrupted backup rejected, restore refused without `CONFIRM=restore`, then a restore that brings back the client and the uploaded file and removes later changes. The CI Docker job now builds the images through Compose and runs this test.
- **Cross-tenant sweep:** `tenancy-sweep.int-spec.ts` builds a clinic with records across many modules, then calls all 53 parameterised staff GET routes as a second clinic with one sample id from every organisation-owned table (one request per route and table). It fails if any response contains the first clinic's ids. No leaks were found. As a check that the test can fail, running it with the first clinic's own session flags 20+ responses.
- **Export auditing fixed:** the client statement CSV and report CSV downloads were not audited, although SECURITY.md and PRIVACY.md said every export was. They now record `client.statement_exported` and `report.exported`. The audit filter accepts a comma-separated list of action prefixes; the audit page has **Exports (all)** and **Privacy requests** options (the old "Exports" option only matched client-list exports).
- **Browser test** `e2e/privacy-audit.spec.ts`: a manager downloads a client's data, anonymises the client (a reason is required), and finds both requests in the filtered audit log and its CSV; reception does not see the privacy tools.
- **Tests executed:** shared 27/27; API 141/141 (25 suites); Playwright 22 passed and 2 skipped (portal) on a fresh seed; backup/restore script passed; ESLint and `tsc` clean.

### 2026-10-16 — Gap closure after Milestone 10
Items from the feature matrix that need no external device, data source or provider.
- **Privacy:** anonymisation now also redacts client-portal messages (subject, text, and the client's name on messages they wrote). The correspondence lock (`client_message_lock`) allows only this fixed redaction; any other edit or a delete is still refused (migration `client_message_redaction`).
- **Global search:** prescriptions by number (`RX-12`, `rx12`, `RX-000012`); every result type now has its own group heading and icon in the search box.
- **Calendar:** month view; drag an appointment to another time, day or clinician column (15-minute snap). The server applies the same checks as the reschedule dialog; a clash or a time outside working hours asks "Move anyway?".
- **Reports:** Clinical activity — consultations by clinician and species, top diagnoses (same wording counted together), hospital admissions/outcomes/average stay, surgeries by procedure, new patients by species. Counts only; CSV export is audited.
- **Inventory:** purchase requests (new permission `procurement.request`, granted to stock-using roles by migration) turned into one draft purchase order by procurement, or rejected/cancelled with a reason; supplier returns (append-only `SupplierReturn`/`SupplierReturnLine`, migration `purchase_requests_supplier_returns`) take a batch from a location at its cost as `RETURN_TO_SUPPLIER` and reduce the supplier balance; cost of goods is unaffected. New pages: Inventory → Item requests, Supplier returns; supplier account shows returns.
- **Tests executed:** shared 27/27; API 145/145 (27 suites); ESLint and `tsc` clean; Playwright: the 3 new scenarios pass. Full suite without resetting the demo data (it is in use): 23 passed, 2 skipped (portal), 2 failed — the demo surgery and demo insurance claim scenarios, whose one-off demo records were already completed by earlier runs; they passed on the last fresh seed and the code they exercise was not changed.
- **Still open (need outside parts):** lab analyser/DICOM and anaesthesia monitor connectors, drug interaction data, SMS/WhatsApp providers, offline sync, barcode hardware, document template designer and e-signatures, custom report builder, shift swaps/timesheets.

### 2026-10-16 — Staff accounts with temporary passwords
- **Requested by the clinic:** add staff without email invitations. Settings → Staff accounts → Add staff now offers "Send invitation email" or "Create temporary password".
- **API:** `POST /staff/with-temporary-password` (new accounts only; an email that already has an account must be invited, so an existing password is never replaced) and `POST /staff/:id/temporary-password` (new temporary password for a member whose account belongs only to this organization; not for yourself, platform admins or members whose roles you could not assign; revokes their sessions and pending reset links; activates a member whose invitation never arrived). The password is generated server-side, returned once, stored only as an Argon2id hash and never written to the audit log (`membership.created_with_temporary_password`, `membership.temporary_password_issued`).
- **Forced change:** migration `temporary_passwords` adds `User.mustChangePassword` and `temporaryPasswordExpiresAt` (7 days). While set, the auth guard answers every route except session, sign-out and change-password with `403 PASSWORD_CHANGE_REQUIRED`, and the web app shows only a "Choose your own password" screen. The new password must differ from the temporary one; a password reset by email also clears the flag. Expired temporary passwords are refused at sign-in with an explanation.
- **Tests executed:** API 148/148 (28 suites; new `temporary-password.int-spec.ts`, 3 tests); Playwright `temporary-password.spec.ts` passes (create → show once → sign in → forced change → old password refused → new password works); ESLint and `tsc` clean.

### 2026-10-16 — Shop products: food, grooming, accessories, supplements
- **Requested by the clinic:** sell food, grooming items and other pet products at the shop counter, not only pharmacy products.
- **Schema:** migrations `retail_product_types` (new product types SUPPLEMENT, GROOMING, ACCESSORY; separate because new enum values cannot be used in the same transaction) and `retail_products`. They add `ProductCategory` (clinic-managed shelves with an optional product type, unique name, hidden instead of deleted) and `Product.categoryId`, `brand`, `packSize` and `photoAttachmentId`. The unused free-text `Product.category` is migrated into categories and dropped. Existing and new organizations get 15 starter shelves (`DEFAULT_PRODUCT_CATEGORIES`); these are shop groupings only.
- **Rules:** only medicines and vaccines can be prescription-only or controlled (enforced on the server). A product's category must belong to the clinic and match its type. Product photos are attachments of the product (read: `inventory.read`, write: `inventory.write`).
- **API:** `GET/POST/PATCH /product-categories`, `POST /products/:id/photo`, product list filters `kind=shop|clinical` and `categoryId`, brand search, POS catalogue `categoryId` filter with brand/pack/category/photo, and the report `sales-by-category`.
- **Web:** Inventory → Products (type tabs, category filter, photos, category manager); the product form asks for the type first and then shows only the relevant fields (strength and dose data for medicines; brand, pack size, shelf and shop units for shop items), with photo upload when editing. The shop counter has sections and shelf chips, and tiles show photo, brand and pack size. Product pages show the type, shelf, brand and pack size and have an Edit button. Reports → Sales by category. Help guide "Add food, grooming items and accessories for the shop". The demo seed adds nine labelled demo shop items with stock.
- **Bug fixed:** the delivery, purchase-order, item-request and supplier-return dialogs pre-selected the first default location of *any* branch, so a delivery at one branch could land in another branch's stock. All four now use the current branch's default location (`lib/locations.ts`).
- **Tests executed:** API 151/151 (29 suites; new `shop-products.int-spec.ts`, 3 tests); shared 27/27; Playwright `shop-products.spec.ts` (2 scenarios) passes; the seed was run against a temporary database (then dropped) to check the demo shop items; ESLint and `tsc` clean. The E2E sign-in helper now waits for the page to be ready (clicks before hydration were lost on a busy dev server).

### 2026-10-16 — Receipt printing (80 mm thermal) and Receipts & printing settings
- **Requested by the clinic:** modern receipts on 80 mm paper with the logo, adjustable from settings.
- **Schema:** migration `receipt_settings` — one `ReceiptSettings` row per organization (paper 58/80 mm, side margin 0–8 mm, font size, logo on/off, branding or separate receipt logo, logo width 15–100 %, alignment, black-and-white, title, header, thank-you and policy text, field toggles, auto-print, copies 1–3; database check constraints). Defaults apply until the clinic saves.
- **API:** `GET /receipt-settings` (settings, clinic and branch details, whether a logo prints; readable by staff who print receipts), `PUT /receipt-settings` (`settings.manage`, audited with a diff), `GET /receipt-settings/logo` (the receipt logo or the branding logo). The receipt logo is an attachment target `ReceiptLogo`. Attachment targets can now opt out of download auditing (`auditDownloads: false`): used for organization and receipt logos and product photos, which load on every screen or receipt. Invoice detail lines now carry the product SKU or service code for printing.
- **Web:** `ReceiptDocument` (inline styles in millimetres, identical on screen and on paper) and `printReceipt` (a hidden frame whose page is exactly the roll width and exactly the receipt's length, no margins; it waits for the logo to load; copies print as separate pages so the printer cuts between them). The POS sale screen, Today's sales and invoice pages ("Receipt" next to "Print A4") use it; auto-print after a counter sale is optional. New page Settings → Receipts & printing with a live preview of a sample sale, logo upload, size slider, alignment and a test print. Help guide "Set up receipt printing". The old `components/pos/receipt.tsx` was removed.
- **Tests executed:** API 153/153 (30 suites; new `receipt-settings.int-spec.ts`, 2 tests: defaults, saving, branding vs receipt logo, validation, permissions, clinic separation, no audit noise from logo downloads); Playwright `receipts.spec.ts` passes twice in a row (58 mm layout with its own logo and 2 copies, saved and reloaded; test print and a counter sale print at 58 mm with both copies and the logo loaded; defaults restored), and `billing-pos.spec.ts` still passes; ESLint and `tsc` clean.
- **Limitation:** browsers always show the print window unless the counter PC runs Chrome with `--kiosk-printing`; direct ESC/POS printing (cash drawer kick, cutter commands) would need a local print bridge and is not included.

### 2026-10-17 — Easier everyday flow
- **Requested by the clinic:** make the flow professional and easy to use.
- **Review:** screenshots of the main screens for reception, vet and owner. Findings: the dashboard was a wall of 25+ number tiles (many zero) with no sense of what to do next; empty lists did not point to the next step (e.g. "No invoices" while 18 charges were waiting); finished consultations ended with a short toast only; the whole app was replaced by "Loading…" on each full page load; long sidebar for owners.
- **Dashboard → Today workspace:** "Needs your attention" turns the dashboard data into a short, ordered to-do list (urgent → to do → for today), shows only non-zero items, and gives each a plain sentence and an action. Links depend on the user's permissions (e.g. low stock → Reorder for procurement, otherwise the stock list). Then "Today at a glance" counts, today's lists (appointments, unsigned notes, follow-ups, surgery, up to 5 critical alerts), and a separate "Business insights" section that holds the branch and period filters (they only affect those numbers). Quick actions are one compact row.
- **Next steps:** a completed consultation shows Bill this visit (new invoice with the client's unbilled charges selected), Book a recheck and Back to the waiting list; the completion toast has a "Bill this visit" button. The Billing list's empty state says how many charges are waiting and offers "Invoice unbilled charges".
- **Navigation:** the ⌘K box lists actions (new client, book, walk-in, counter sale, new invoice, receive stock, request an item) filtered as you type, shared with the top bar's New menu (`components/layout/create-actions.ts`). Sidebar sections can be folded; the section with the current page always stays open; the choice is remembered on that computer.
- **Loading:** the app's outline (sidebar, top bar, page placeholders) shows immediately instead of a blank "Loading NextCore…" screen.
- **Tests executed:** Playwright `flow.spec.ts` (every attention link opens for reception, vet and nurse without "Access denied"; ⌘K action; complete a consultation → Next steps → Bill this visit opens the invoice for the right client); ESLint and `tsc` clean; full browser suite run (results in the session report).

### 2026-10-17 — QA pass: broken and unprofessional flows fixed
- **Requested by the clinic:** test every flow and fix anything broken or unprofessional.
- **How:** four role-based QA passes in the browser (front desk, clinical, commercial, services/admin/mobile) at desktop and phone width, about 110 findings; each was checked in the code before fixing.
- **Broken flows fixed:**
  - Phone layout: the top bar, client page, patient tabs and shop counter overflowed (sign-out was off-screen). The counter now has a Charge bar at the bottom on phones.
  - Dates near midnight: dates were taken from UTC, so between 00:00 and 05:00 in Pakistan they were a day early. This affected date of birth, problem onset, task due dates, farm reports and the next due date of vaccinations (364 days). Dates now use the branch's local date, on both web and server.
  - Labels: one shared label map gave grooming jobs the badge "In surgery" and wards "General message". Labels are now per domain (`enumLabel(value, scope)`).
  - Links people could not open: Help, the dashboard "Validate" item and the prescription → consultation link now check permissions. Pharmacy staff no longer get 403 errors on patient pages.
  - Front desk and consultation:
    - Starting a consultation now assigns the clinician and copies the triage complaint and vitals into it.
    - Administered mass doses (e.g. 200 mg of a 200 mg tablet) are now charged and deducted from stock.
    - Vaccinations record their batch, so it shows on the certificate.
    - The consultation page no longer scrolls sideways once a prescription exists.
- **Professional polish (examples):**
  - Dashboard:
    - Lists booked patients who are late, and visits from earlier days that were never closed.
    - Groups critical alerts per patient; next appointments exclude patients already checked in.
  - Front desk and appointments:
    - "Undo no-show", "Keep appointment", "Book again"; a warning when booking in the past; same-patient clash wording.
    - A new client's address is optional.
  - Billing and stock:
    - Statements say "Card payment for INV-…"; invoices made from charges are filed against the animal.
    - Report CSVs have named columns, amounts in major units, local dates, totals and a header row even when empty (UTF-8 BOM for Excel).
    - Stock movements link to the sale, delivery, count or return that caused them.
    - Reorder suggestions are grouped by last supplier, with last cost prefilled, and purchase orders can be printed.
  - Clinical:
    - The dispensing batch picker shows expiry and quantity on hand.
    - Lab samples have a Code 128 barcode, and samples are split by sample type.
    - Lab reports and medication labels carry the clinic's details.
    - Treatments are "Due now" for 30 minutes before counting as overdue; discharge warns about unrecorded treatments.
    - The patient Documents tab includes files from consultations, stays and lab orders.
  - Services and admin:
    - Help search matches words, not exact phrases.
    - The staff table fits its card, with row actions in a menu.
    - Farm production charts are split by unit.
    - The audit log shows readable actions and records, with search.
    - Tabs switch instantly.
  - App-wide:
    - Sentence-case badges.
    - "Searching…" state in ⌘K.
    - Dark-mode selects.
    - Aligned form fields.
    - A4 invoice header matches the receipt.
- **Configuration gap found (needs a decision, not code):** a consultation started directly rather than from an appointment or walk-in has no consultation-fee source, because the fee comes from the appointment type's service.
- **Demo data:** repeated E2E runs have left test records in the Pakistan demo clinic (E2E-*, "Temp Receptionist" staff, "Allergy to …"). Only re-seeding with `npm run db:seed -- --reset` removes them, and it also removes data added by hand, so it has not been run.
- **Tests executed:** shared 27/27; API full run 31 suites — 29 passed first time, and the 2 that failed (the new `qa-polish.int-spec.ts`, whose test data needed an open cash register and a non-prescription item, and a security assertion affected by a statement wording change that was then reverted) pass on re-run, 162 tests in all. New tests: `qa-polish.int-spec.ts` (statement wording, invoice filed against the animal, sales-by-item names/totals/CSV, empty CSV header, movement references, reorder last cost/supplier), scheduling (triage carried into the consultation, starting clinician, same-patient clash), preventive (local-day next due), pharmacy (mass-dose charging), patients (empty duplicate filters, related documents), `tz.spec`. ESLint and `tsc` clean. Playwright, re-run spec by spec after the push: 28 of 31 scenarios pass (plus 2 portal scenarios skipped while the portal is off). The first full run found one real regression, fixed here: the top bar's new search-button label clashed with the patient search box. Six tests were updated for intended wording and behaviour changes: "On draft order", locations named with their branch, sample-type confirmation on collection, and a batch number shown twice. Three failures are demo-data exhaustion, not code: the demo surgery and the demo insurance claim were already completed by earlier runs, and the demo "Elizabethan collar" is out of stock. They pass after `npm run db:seed -- --reset`, which has not been run because it would remove data added by hand.

### 2026-10-17 — Ease of use for first-day staff
- **Requested by the clinic:** "we want it easy to use and easy to understand". The interface stays English only (no Urdu), in plain wording for second-language speakers.
- **How:** four usability walkthroughs as untrained staff (front desk, vet/pharmacy/lab, owner/manager on an existing and a brand-new clinic) plus a wording audit of about 7,900 UI strings. Every task was timed in steps, and each hesitation point was written down.
- **One vocabulary everywhere:** Client, Patient, Vet, Appointment/Consultation, Invoice (Unpaid / Partly paid / Paid / Cancelled), "Not yet invoiced", Cash drawer (starting cash, difference), Store room, Shop counter, Rs, British spelling, "Add …" / "Save". Urgency reads Critical — see now / Very urgent / Urgent / Can wait / Routine. Abbreviations come after plain words (e.g. "By mouth (PO)", "Heart rate (beats/min)").
- **Navigation:** short menu names (Pharmacy, Lab & X-ray, Hospital, Shop counter, Billing, Stock, Reports, Messages, Activity log). The Settings home is grouped cards with one line each (Your clinic, Staff & access, Prices & billing, Rooms & spaces, Clinical setup). A new **Services you offer** setting hides Hospital, Surgery, Lab, Farms, Boarding or Insurance when the clinic does not offer them, and never deletes data (existing column `Organization.disabledModules`).
- **Dashboard by role:**
  - Reception sees Waiting now, Arriving next (with Check in) and Still to do.
  - The owner sees "Money today": received today and this month, clients owe, not yet invoiced.
  - Quick actions depend on the role.
  - A cash drawer left open from an earlier day becomes a to-do.
- **First day:**
  - An 11-step "Get your clinic ready" checklist with Start and Skip; skip and hide are stored per clinic (migration `setup_checklist_state`).
  - New clinics get a cash drawer per branch and a starter price list (Consultation, Follow-up, Vaccination, Deworming at Rs 0, marked "Set your price") with linked appointment types.
- **Front desk:**
  - Add a new client and patient from inside the walk-in and booking windows.
  - Phone search ignores spaces, dashes and +92.
  - The surname is optional, and names show first-name-first (migration `client_display_name_order`).
  - Short forms with "More details (optional)", and "What next?" after saving.
  - Booking: "Any vet (first free)", Today / Tomorrow / Next week, and the reason when Book is disabled.
  - One-tap cancel reasons.
  - Cards show the client and phone, and waits read "9 h 12 min".
  - Plain-sentence confirmations that stay 6–12 s.
  - Amount owed shows in search and on the client page.
- **Billing and shop counter:**
  - Split card + cash payments on invoices, and a print button per payment.
  - "Not yet invoiced" is grouped by client (`GET /charges/by-client`).
  - "Finish invoice", and credit shown in green (never a minus).
  - Shop counter: out-of-stock items last with an explanation, "+ Other item", word and category search, "Take payment", "Pause sale".
  - A note counter when closing the cash drawer.
- **Stock, staff and prices:**
  - Shop items can be received without a batch or supplier ("Bought locally"), and the disabled button explains why.
  - The setting "Purchase orders need a second person to approve" (migration `po_second_approver_setting`; on for existing clinics, off for new ones).
  - "Order these" from low stock, and "Add opening stock" after creating a product.
  - Stock tabs are grouped under "More".
  - Appointment types show the linked service's price, so there is one price only.
  - "Add staff" on the Staff page; common roles first; "vet" ticked automatically; temporary password by default.
- **Clinical:**
  - **Allergy matching:** checks the medicine name, ingredients and a new per-product "Drug class / family". A "Penicillin" allergy now warns on amoxicillin.
    - The prescribe dialog shows an allergy strip, marks matches in the search list, and shows a red box as soon as a product is picked.
    - Authorising a draft re-checks allergies on the server.
    - The pharmacy shows "May conflict with allergy — ask the vet".
  - **Finishing a consultation:** "Finish consultation" opens a checklist with "Sign notes & finish". "Sign & lock note"; a lasting reminder when notes are still unsigned.
  - **Validation:** vital-sign errors appear on the field itself ("Temperature must be between 25 and 46 °C", "Did you mean 39.8?").
  - **Dose checks:**
    - An amber box when no dose range is set up for the species.
    - A clinic setting asks to confirm when one dose is a large number of tablets (default 4). This is a safety prompt, not a dose.
  - **Plain wording:**
    - Note sections are History / Examination findings / Assessment / Plan, with "Insert vitals".
    - Plain route, frequency and vital-sign names.
    - Owner labels read "Give 1 tablet by mouth 2 times a day for 7 days".
  - **Consultation page:** an action bar, slim empty cards, a "Charges sent to reception" card, and a recheck defaulting to a follow-up type.
  - **Pharmacy and lab:** "Ready to hand over", "Approved by", "Print label" after dispensing. The lab worklist has an "Open" button and a "Sample collected. Next: enter results" message.
  - **Starting a consultation:** if the patient is already checked in, the dialog offers to start that appointment.
  - **Migration:** `clinical_drug_class_dose_prompt`.
- **Security:** sign-in and other password forms now always POST, so a click before the page finishes loading can no longer put a password in the address bar.
- **Tests executed:**
  - Shared: 35/35.
  - API: 177/177 across 32 suites. New or extended suites:
    - onboarding: starter data, steps, modules, front-desk widget, cash drawers;
    - billing-ease: shop search, charges by client, "Other item" permission;
    - inventory: one-person order approval;
    - clients: phone search with spaces, names;
    - pharmacy: drug-family allergies, large-dose prompt;
    - clinical: vital-sign messages.
  - ESLint and `tsc` clean.
  - Playwright full run: 26 passed, 11 failed, 2 skipped (portal off). After fixes, each failing spec was re-run and passes, except the 2 one-off demo-record scenarios (the demo surgery and the demo insurance claim), which need `npm run db:seed -- --reset`. That has not been run because it would remove data added by hand.
  - Real bug the run found, now fixed: opening "Add order" from a link (`?new=1`) re-ran on every render and crashed with "Maximum update depth exceeded". It is now handled once per link.
  - Other fixes from the run:
    - Selectors for renamed labels.
    - A stock top-up helper (`ensureStock`) so counter-sale tests no longer depend on demo stock that runs out.
    - The hospital test discharges a stay left over from an interrupted run.
    - Pharmacy quantities pluralised ("14 tablets", "… handed over").


### 2026-10-19 — Multi-clinic hosting: one database per clinic, subdomains, super admin
- **Requested by the owner:** host many clinics from one installation. A super admin adds clinics. Each new clinic gets its own database, created automatically, and each clinic uses the software at its own subdomain.
- **Decisions (owner):**
  - A separate PostgreSQL database for each clinic, rather than a shared database or a schema per clinic.
  - Only the super admin adds clinics.
  - The domain comes from configuration (`BASE_DOMAIN`).
- **How it works:**
  - `DATABASE_URL` is the platform database: clinics (`Tenant`), super admins and platform audit events.
  - Every request's address (`X-Forwarded-Host`, set by the Next.js proxy) is mapped to a clinic. `PrismaService.raw`/`db` then return that clinic's client, from a pool that closes clients idle for 10 minutes. Because of this, no module code changed.
  - Unknown, paused and unfinished clinics, and the bare domain, get only `/health` and `/tenant`.
  - Background jobs (reminders, message dispatch, hospital upkeep) run once per clinic database through `TenancyService.forEachDatabase`.
  - Without `BASE_DOMAIN`, everything works as before.
- **Adding a clinic:**
  1. `POST /platform/clinics` records the clinic.
  2. In the background, it creates `vcms_t_<slug>` and runs `prisma migrate deploy` on it.
  3. Inside the new database it creates the organization, branch, system roles, owner, species, shop categories, starter price list and cash drawer.
  - The owner gets either a temporary password, shown once (only its hash is kept, until set-up ends), or an invitation email with a link at the clinic's address.
  - A failed set-up is recorded and can be retried; every step is safe to repeat.
  - Other actions: pause, reactivate, and a new owner password. Everything is audited.
- **Security:**
  - Platform permission `platform.clinics.manage` is outside the role catalogue and is granted only to `isPlatformAdmin` users at the admin address.
  - Only platform admins can sign in at the admin address.
  - The Origin check requires a request to come from the address it is sent to.
  - Self-registration is refused in multi-clinic mode.
  - Email links use the clinic's own address.
- **Web:**
  - The middleware routes by address: `admin.` → `/platform`, the bare domain → `/find-clinic`, and a clinic address → the app, with `/register` closed.
  - Super admin Clinics page: list with status, Add clinic dialog (address suggested from the name), owner password dialog, per-clinic actions, auto-refresh while a clinic is setting up.
  - The sign-in page names the clinic or says "Super admin sign-in".
  - New "Find your clinic" page.
- **Operations:**
  - `node dist/cli/platform.js migrate | create-admin | add-existing | list` (`npm run platform -w @vcms/api -- …` in development). The Docker entrypoint now runs `migrate` for all databases.
  - New `scripts/backup-all.sh`. `backup.sh` has `INCLUDE_STORAGE=false`, and `verify-backup.sh` and `restore.sh` handle database-only backups.
  - Compose and web image settings: `BASE_DOMAIN`, `PLATFORM_SUBDOMAIN`, `DB_NAME`.
  - Guide: DEPLOYMENT.md §8.
- **Schema:** migration `platform_tenants` (enum `TenantStatus`, table `Tenant`).
- **Also fixed:** the clinical activity report labelled a diagnosis with whichever spelling the database returned first. It now uses the first-recorded spelling (this caused an intermittent `reports-clinical` failure).
- **Tests executed:**
  - API: 189/189 in 34 suites. New `multi-clinic.int-spec.ts` (8 tests, real databases):
    - addresses and the bare domain;
    - super admin sign-in rules;
    - address validation;
    - creating a clinic with a temporary password;
    - a second clinic with an invitation;
    - isolation of records, accounts and cookies;
    - jobs visiting every clinic;
    - pause and reactivate;
    - new owner password;
    - failed set-up and retry.
  - API unit: new `hosts.spec.ts` (address mapping, origins, database names).
  - Shared: 35/35. ESLint and `tsc` clean. The web production build succeeds.
  - Manual run in multi-clinic mode on separate ports (API, Next.js and the CLI against local PostgreSQL):
    - The existing demo database was hosted as `demo`.
    - A super admin added two clinics, each ready in about 4 seconds.
    - Their owners signed in at their own addresses, and accounts were refused across clinics.
    - A cross-address POST was refused.
    - The UI was driven in headless Chromium (find clinic → clinic sign-in → super admin → add clinic → owner first sign-in) with no console errors and no sideways scrolling at 390 px.
    - `backup-all.sh` backed up all databases, and `verify-backup.sh` passed on a clinic backup and on the platform backup.
- **Not included:**
  - Deleting a clinic or renaming its address.
  - Custom domains.
  - Per-clinic plans or billing.
  - Moving uploaded files into per-clinic folders. Files stay in one store, keyed by organization id.

### 2026-10-19 — White-label branding (owner only)
- **Requested by the owner:** make the app white label: each clinic uploads its logo and sets its colours. Only the clinic owner may do this.
- **What a clinic can set** (Settings → Branding, with a live light/dark preview):
  - the name shown in the app (defaults to the clinic name);
  - the logo;
  - a separate browser-tab icon (falls back to the logo);
  - a main colour (buttons, links, highlights) and a menu colour;
  - a sign-in page headline and message.
- **Where it shows:**
  - The menu (logo and name).
  - The whole colour theme, in light and dark mode.
  - The clinic's sign-in page: side panel, logo above the form on phones, and "Sign in to …".
  - The browser-tab title and icon.
  - Receipts and printouts (logo).
  - Staff emails: invitation and password reset use the clinic's name, button colour and footer, and "NextCore" no longer appears. The authenticator app lists the clinic's name.
  - In multi-clinic mode, and in a single installation with one organization, the sign-in page and first paint already carry the branding. The root layout fetches `/tenant` on the server, so there is no flash of the default look.
- **Readable colours:** `brandThemeVariables` (shared) keeps the chosen colour when it reads well. Otherwise it changes only its lightness: links and controls meet 3:1 against white and against the dark background, and button text meets 4.5:1. Menu text switches between light and dark for the menu colour. New sidebar tokens `--sidebar-strong` and `--sidebar-hover` replace hard-coded white.
- **Owner only:**
  - New permission `branding.manage`, held only by the system owner role (data migration for existing clinics).
  - It is listed in `OWNER_ONLY_PERMISSIONS`: left out of the role editor's catalogue and refused when creating or editing any role.
  - Logo and icon uploads use the new attachment target `Branding` (write: `branding.manage`).
  - `POST /organization/logo` now needs `branding.manage`, where it used to need `org.manage`.
- **API:**
  - `GET`/`PUT /organization/branding`;
  - `POST /organization/logo|icon` (set or remove);
  - `GET /organization/logo|icon`;
  - public `/tenant` with branding, and public `GET /tenant/logo|icon` (serve only the clinic's own logo or icon, images only);
  - `organization.branding` in the session.
  - `primaryColor` moved from the organization form to branding.
- **Schema:** migration `clinic_branding` (`brandName`, `sidebarColor`, `iconAttachmentId`, `loginHeadline`, `loginMessage`, `brandingUpdatedAt`). Existing colours are lowercased, and both colours get `#rrggbb` check constraints.
- **Tests executed:**
  - Shared 40/40. New `branding.test.ts`: validation; contrast for light, dark, white and black colours; menu text; only the owner template has the permission.
  - API 193/193 in 35 suites. New `branding.int-spec.ts`:
    - defaults, save and audit, session;
    - logo and icon upload, fallback, removal, and only this clinic's branding images;
    - a practice manager is refused everywhere, and the permission cannot be put into a role;
    - branded invitation and reset emails.
  - `multi-clinic.int-spec.ts` now also checks that each clinic's public sign-in branding is its own.
  - ESLint and `tsc` clean. The web production build succeeds.
  - Browser run (headless Chromium, multi-clinic dev servers), as the demo owner:
    - set the name, colours, sign-in text, logo and icon;
    - the dashboard, tab title, icon and sign-in page carried them, server-rendered;
    - a light menu colour stayed readable;
    - a practice manager saw no Branding entry and was refused the page;
    - no console errors in three consecutive runs.
- **Not included:** custom fonts, a custom domain per clinic, and branding the super admin area (it stays NextCore).

### 2026-10-19 — Advanced white-label branding
- **Requested by the owner:** "make it more advanced". They chose look and feel, sign-in page design, and printouts and emails. Branding stays owner-only.
- **Look and feel:**
  - eight ready-made themes (`BRAND_PRESETS`: colours, font, corners in one click);
  - a font from seven self-hosted Google fonts plus the device font. `next/font` downloads them at build time and loads them only when used, through `--font-brand`;
  - corner style (sharp, standard, rounded), through `--radius`;
  - the clinic's default light/dark/device theme for staff who have not chosen one. Their own choice is remembered and wins;
  - a logo version for dark backgrounds, used on dark menus, the sign-in panel and in dark mode.
- **Sign-in page** (`SignInFrame`):
  - layout: side panel or centred card;
  - background: menu colour, a blend into the main colour, or an uploaded photo darkened for readable text;
  - a footer line;
  - on phones, the logo sits above the form.
- **Printouts:** a shared `Letterhead` and `LetterFooter` replace the hand-built headers of invoices, purchase orders, vaccination certificates, discharge summaries, lab reports, surgical reports, referral letters and claim forms. They add:
  - the logo on the left, centre or right;
  - a line under the clinic name and a footer text;
  - name and rules in the brand colour, falling back to black for light colours or when turned off.
- **Emails:** every clinic email carries the clinic's sender name ("Name" <platform address>, so SPF/DKIM are unchanged), Reply-To set to the clinic's email, its signature (text and HTML) and its colour. This covers invitations, password resets, and reminders and client messages through the dispatcher.
- **Settings → Branding** is reorganised into four tabs (Look & feel, Sign-in page, Printouts, Emails). Each tab has a live preview of the unsaved draft: the app in light/dark, the scaled sign-in page, the top of a printed invoice, and an email. There is a sticky Save / Undo bar.
- **API and schema:**
  - migration `branding_advanced`: enums `BrandFont`, `CornerStyle`, `ThemeMode`, `LoginLayout`, `LoginBackground`, `PrintLogoPosition`; image columns `logoDarkAttachmentId` and `loginBackgroundAttachmentId`; text fields with database length checks;
  - `POST`/`GET /organization/logo-dark|login-background`, and public `GET /tenant/logo-dark|login-background`;
  - sender names may not contain `<`, `>`, `"`, `@` or line breaks (header safety).
- **Tests executed:**
  - Shared 43/43 (font and corner variables, preset readability, sender-name safety).
  - API 195/195 in 35 suites. New tests: saving every new setting and rejecting invalid ones; dark logo and sign-in photo upload; practice manager refused; a client message dispatched with the clinic's From name, Reply-To and signature.
  - ESLint and `tsc` clean. The web production build succeeds with the fonts bundled.
  - Browser run as the demo owner:
    - applied the Lavender theme, both logos, a centred card on a photo, a centred letterhead with header and footer, and a sender name and signature;
    - the dashboard used Poppins, rounded corners and the white logo on the dark menu;
    - the sign-in page (desktop and phone) and a printed real invoice carried the branding;
    - a real email in Mailpit had the sender name, Reply-To and signature;
    - a clinic default of dark opened the app dark for a vet who had not chosen a theme;
    - no console errors.
- **Note:** building the web image needs internet access once (fonts).

### 2026-10-20 — Easier daily flow and super admin dashboard
- **Requested by the owner:** "make the flow more easy", for daily staff work and the super admin dashboard.
- **How:** a full visit was walked through in the browser as reception, vet and cashier (walk-in → consultation → bill → payment), noting every extra click. The super admin screens were reworked the same way.
- **Daily staff work:**
  - **Start from the dashboard.** "Waiting now" on a vet's dashboard has a Start button that opens the consultation, with no detour through the front desk.
  - **Finish keeps the last words.** Notes typed in the last two seconds before Finish consultation (before autosave) are saved before the checklist is shown. The checklist used to say "No notes written yet" and hid "Sign notes & finish" although the notes were saved when finishing.
  - **Bill from the front desk.** A finished visit whose client still has work not yet invoiced shows Bill. It opens a new invoice with those items ticked. The queue API returns `unbilledCharges` per finished visit.
  - **Finish & take payment.** The new invoice page offers "Finish & take payment", which opens the payment window as soon as the invoice is finished, and "Finish, pay later". Staff without `payments.take` keep "Finish invoice".
  - The help guides "Invoice a client" (it still used old wording) and "Start a consultation" are updated.
- **Super admin dashboard:**
  - Tiles for all, ready, paused and failed clinics that filter the list; search is always shown.
  - Rows open the clinic. Inline Open and Copy address buttons; Try again on failed set-ups; a status line explaining Setting up, Paused or the failure.
  - New clinic page `/platform/clinics/:id`:
    - usage counted in the clinic's own database (staff, clients, patients, appointments this month, last sign-in), via `GET /platform/clinics/:id/overview`;
    - the platform history in plain words;
    - sign-in details with copy buttons;
    - "Owner can't sign in? New password";
    - status banners with the next action.
  - Owner sign-in details come as a ready-made message (address, email, temporary password, expiry) with Copy message and Send on WhatsApp.
  - The Add clinic form is shorter: main branch defaults to "Main branch" and is moved to the end; the access choices are in plain words.
- **Tests executed:**
  - API 197/197 in 35 suites. New tests: clinic overview (usage counts, history, refused for clinic staff); finished visits report work not yet invoiced, and the count clears once invoiced.
  - Shared 43/43. ESLint and `tsc` clean.
  - Playwright against the multi-clinic dev servers:
    - new `flow.spec.ts` scenario: walk-in → vet starts from the dashboard → notes typed and finished at once are kept and signed → front desk Bill → Finish & take payment available;
    - `billing-pos.spec.ts` invoice scenarios updated (Finish & take payment opens the payment window; Finish, pay later);
    - `scheduling-clinical.spec.ts` and `clients-patients.spec.ts` pass. Two search scenarios needed a re-run: a keyboard shortcut was pressed before the page was ready.
    - Test fixes: exact button names ("Take payment" also matched the new button); leaving the page before clearing cookies in the dashboard-links scenario (the open page redirected itself to sign-in and raced the test).
  - The POS dispensary scenario cannot run against a `*.localhost` address: Node cannot resolve it for the test's API helper.
  - Browser check of the super admin flow: add a clinic → welcome message copied exactly → list while setting up → filter → clinic page on desktop and phone, with no console errors.

### 2026-10-20 — Easier daily flow, round 2: pharmacy and vaccination reminders
- **How:** the pharmacy, lab, vaccination-reminder and shop-counter flows were walked in the browser as the pharmacist, lab user and receptionist. The lab worklist and shop counter already had one clear next action and were left alone.
- **Pharmacy worklist:** each row has an action: **Hand over** (opens the dispense window straight away, with the allergy check and batch choice) on prescriptions ready to dispense, and **Authorise** (with the usual confirmation) on drafts for staff allowed to authorise. Before, every step began with opening the prescription.
- **Vaccines & reminders:** the due list has **Book** beside Remind. It opens the calendar's booking window with the patient, the reason and, for vaccinations, the Vaccination appointment type already filled in (`/calendar?book=1&patient=…&reason=…&type=VACCINATION`). Booking dialog default `typeCategory` is applied once per opening, so it never overwrites what staff type.
- The help guides "Dispense a prescription" and "Vaccinations and parasite control" describe the new buttons.
- **Tests executed:**
  - New Playwright scenarios in `flow.spec.ts`: Hand over opens the dispense window without leaving the list; Book opens with patient, reason and Vaccination type set.
  - `preventive.spec.ts` and `calendar-views.spec.ts` pass; `pharmacy-lab.spec.ts` 4 of 5. The failing scenario signs in as `lab@demo.pk`, whose demo password was changed by an earlier run (demo-data drift; re-seeding restores it).
  - Typecheck and ESLint clean. No API changes, so the API suites were not re-run.

### 2026-10-20 — Plans: the super admin chooses what each clinic may use
- **Requested by the owner:** the super admin should change a clinic's plan and decide which features the client may use and how many staff and branches it may have, professionally.
- **Plans (platform database):** `Plan` (name, price for reference, staff and branch limits where unlimited is null, feature list, switched on or off). Starter, Clinic and Hospital are created the first time. Features: Lab & X-ray, Hospital, Surgery, Livestock, Boarding, Insurance, Reports and Branding. Everyday work is in every plan.
- **Per clinic:** a plan, plus optional exceptions for that clinic only: its own staff or branch limit, features added or taken away (`Tenant.planId` and four override columns). A clinic with no plan, and every clinic that existed before plans, has no limits.
- **Enforcement on the server:**
  - Entitlements are resolved from the plan and exceptions (`resolveEntitlements`) and travel with every request (`TenantRef`, cached 15 s and cleared immediately when the plan changes).
  - Features: permissions are named by area (`lab.read`, `reports.view`, …), so a plan that lacks an area removes those permissions from everyone in the clinic. Every route and the whole interface follow, without per-route rules. A denied request answers `PLAN_FEATURE` with a plain message.
  - Limits: adding or reactivating staff (active and invited count) and adding or reopening a branch answer `PLAN_LIMIT` with the numbers.
  - Lowering a limit or a plan never removes anyone; a clinic above it keeps what it has and cannot add more.
  - Role checks ignore permissions outside the plan, so an owner can still assign ordinary roles (found by the tests).
  - Dashboard panels and Services you offer follow the plan; areas outside the plan keep the clinic's earlier on/off choice for an upgrade.
- **Super admin:**
  - A Plans page with plan cards and an add/edit dialog.
  - Each clinic's page has a Plan & limits card: choose the plan, see usage against the limits, change the limits or features for this clinic, and an over-limit warning.
  - The clinics list shows the plan, and Add clinic chooses one.
  - Every change is in the clinic's history; new platform permission `platform.plans.manage`.
- **Owner:** Settings → Your plan (plan, two usage meters, what is included or locked, "ask NextCore"); Add staff and Add branch show "3 of 5 used" and are disabled with the reason when full; Services you offer shows locked areas.
- **Tests executed:**
  - Shared 48/48: new `plans.test.ts`.
  - API 204/204 in 35 suites: 7 new plan tests in `multi-clinic.int-spec.ts`. They cover:
    - the starter plans and who may manage plans;
    - areas closing for everyone (lab, branding and reports answer `PLAN_FEATURE`) while everything else keeps working;
    - staff and branch limits, per-clinic exceptions, and lowered limits that keep what exists;
    - the history, switched-off plans, plans in use that cannot be deleted;
    - plan edits reaching clinics at once, and a new clinic starting on a plan.
  - Browser run as super admin and as the owner of the demo clinic: choose Starter with a staff limit of 12, the owner's menu loses Lab, Hospital and Reports, Your plan and the staff page show the limits, no console errors.
- **Not included:** taking payment from clinics or invoicing them; usage-based or per-patient charging; trial periods and expiry dates (a clinic can be paused).

### 2026-10-20 — Premium UI refresh
- Design tokens in `globals.css` / `tailwind.config.ts`: softer layered shadows (`card`, `card-hover`, `pop`, `glow`), larger radii, `app-canvas` background glow, page-enter animation.
- Restyled shared components (card, button, input, badge, table, dialog), sidebar (glowing active item), top bar, page headers, stat tiles; avatars in patient/client lists.
- Dashboard gets a gradient hero banner with the day's key numbers; sign-in pages (default and clinic-branded) get a gradient glow panel, paw watermark and a card-style form.
- White-label safe: everything uses the clinic's CSS variables (colours, font, corner size). Checked light, dark and phone width; fixed a phone overflow in the dashboard quick links.

### 2026-10-20 — Print a finished consultation
- "Print consultation" button on a finished consultation prints a full record on the clinic letterhead: patient and owner, reason for visit, vitals, signed clinical note and exam findings, diagnoses, medicines given and prescribed, tests ordered, charges and open follow-ups. Charges, medicines and tests only print for users with permission to see them; unsigned drafts are never printed.

### 2026-10-20 — Letterhead designer (Settings → Branding → Printouts)
- The owner designs the letterhead used on every printout: one-click designs (Classic, Centred, Minimal, Plain text), logo position and size, clinic-name size, rule style (band / thin / double / none), which of address, phone/email and tax number to show, footer alignment, and a "pre-printed paper" mode that leaves a blank space of a chosen height (mm) at the top. Live preview beside the form.
- New Organization columns (migration `letterhead_designer`), included in the session branding and the owner-only branding update; `Letterhead` / `LetterFooter` render them for every document. Test coverage added to `branding.int-spec.ts`.

### 2026-10-20 — Patient history inside a consultation
- The consultation screen shows a "Last seen …" line under the patient banner and a **History** button. It opens a dialog with the patient's earlier visits (expand one to read its signed note, diagnosis and vitals), their appointments (past and upcoming) and the full timeline (vaccines, medicines, tests, hospital stays, billing and more). Each tab appears only if the user has the matching permission; nothing in it changes the current consultation. The timeline component is now shared with the patient record.

### 2026-10-20 — Easier for non-technical users
- **Plain words:** remaining "owner / clinician / dispensing unit / identifier / SOAP / PKR" wording in visible text moved to the agreed vocabulary (client, vet, "given out per", microchip or tag, Rs). Technical server messages ("The request contains invalid data", "An unexpected error occurred", "Record not found"…) are rewritten into short what-to-do sentences in `lib/api.ts` (`plainMessage`); messages written for people pass through unchanged.
- **Help on the screen:** `Field` takes a `help` prop that shows a small "?" with a plain explanation (tap, click or keyboard). Added to the confusing fields in the product form, hospital admit, medicine given, lab and surgery urgency, prescriptions repeats, insurance excess and co-pay, tax rate, batch numbers and "how given" routes.
- **Welcome tour:** a 6-step tour on each person's first sign-in on a computer (skip any time, never shown to automated browsers); "Take the welcome tour" in the Help centre reopens it.
- The guided setup checklist for new clinics already existed (11 self-ticking steps) and was left as is.

### 2026-10-20 — Visual polish round 2
- Shared `BarChartCard` (`components/charts.tsx`): gradient bars in the clinic colour, rounded tops, dashed grid lines, card-style tooltip; used by the reports and the dashboard.
- Icons on the Reports summary tiles; a slim route-progress bar at the top while a page loads (`RouteProgress`); rounded, shadowed toast messages.

### 2026-10-20 — Complete patient record (view in a new tab, print, download)
- **Complete record page** `/patients/:id/record`: everything held about one patient on one printable page (letterhead, patient facts, clients and past owners, microchips, alerts, weight history, consultations with signed notes/vitals/diagnoses, prescriptions and supplies, medicines given, lab and imaging results, vaccinations and preventive care, appointments, hospital stays, surgeries, invoices, insurance and referrals, boarding and grooming, livestock records, documents list). Opened by a **Complete record** button on the patient page and on the patient banner (every clinical screen), in a new tab. Print / save as PDF from the page.
- **Download** `GET /patients/:id/record-export` (new permission `patients.export`, granted to owner, practice manager and veterinarian by migration `patient_record_export`): the same record as a JSON file; audited as `patient.record_exported`. `GET /patients/:id/record` needs only `patients.read`, and each section appears only if the user has that module's read permission (the page lists what was left out).
- New registry `PatientRecordService.register({ name, title, anyOf, load })`; clinical, pharmacy, lab, preventive, hospital, billing, insurance, boarding and livestock register their own sections. Test: `patient-record.int-spec.ts`.

### 2026-10-20 — The system recommends what to do next
- **"What's next?" button** in the top bar on every screen: a short list of what needs doing now (the dashboard's attention list, most urgent first, with a count badge), one click to each.
- **Search is now "type what you want to do"**: opening it shows "Suggested for you now" and an "I want to…" list of everyday jobs in plain words (check in someone, take a payment, give a vaccination, hand out medicine…), filtered by the person's role and the clinic's services (`lib/tasks.ts`); typing "take mon" finds "Take a payment".
- **Patient page "Suggested next"**: one suggestion chosen from the patient's own situation (consultation in progress, overdue vaccinations, money owed, or book the next visit).

### 2026-10-21 — Fast consultation notes: tap to add
- **Quick picks under every note field** (presenting complaint, past history, history from the client, examination findings, assessment, plan, instructions for the client). A tap adds the phrase to the text; a second tap takes it out; the answers of one question (a group such as Eating, Drinking, Energy, Vomiting, Stools, Hydration, Gums, Abdomen) replace each other. The text stays fully editable and the vet still reads and signs the note. "Hide buttons" switches them off per computer.
- **Each clinic owns its list**: Settings → Quick note phrases (add, rename, change what is added, regroup, switch off, delete, put back starter buttons). A starter set of everyday observations (no doses or treatment schedules) is added once per clinic (`DEFAULT_NOTE_PHRASES`). New table `NotePhrase`, `Organization.notePhrasesSeeded`, routes `/note-phrases` (read: clinical.read; change: settings.manage; audited). Text logic (`togglePhrase` etc.) is in `@vcms/shared` with unit tests; API tests in `note-phrases.int-spec.ts`.

### 2026-10-21 — Consultation note: five clear steps, normal answers
- The note is written in five steps (Why they came · History · Examination · Assessment · Plan and advice), one open at a time, each showing a one-line summary of what was written and a tick when done, with a progress bar and "Next: …" buttons. "Show all steps" shows everything at once (remembered on this computer). The Save draft / Sign & lock bar stays at the bottom of the screen. Everything typed stays in the page when a step is closed.
- **Normal answers**: each quick-pick question can have a normal answer (`NotePhrase.isDefault`, set in Settings → Quick note phrases → Normal). "Fill in the normal answers" adds the normal answer to every question not yet answered and never changes an answer already given (`fillNormalAnswers`, unit-tested). The starter set marks 12 (eating, drinking, energy, vomiting, stools, urine; behaviour, hydration, gums, heart, lungs, abdomen); migration marks them for clinics that already have the starter phrases.
- Browser tests that fill several note fields now click "Show all steps" first.

### 2026-10-21 — Consultation as a guided visit
- An open consultation now runs in the order of a real visit, as seven steps with a step list on the left (tick when done, small counts): **Arrival & vitals** (reason for the visit + vital signs) → **History** (past history, what the client tells you, problem list) → **Examination** (findings + body-system checklist) → **Diagnosis & tests** (assessment, diagnoses, lab/X-ray orders) → **Treatment** (medicine given now, prescriptions, plan) → **Advice & follow-up** (instructions for the client, follow-up tasks, photos and documents) → **Review & finish** (what is done and what is not, the charges, Finish consultation).
- The panels that used to sit in a side column now live in the step where they belong; the action bar (Vitals, Diagnosis, Prescribe, Give medicine now, Order test, Upload) jumps to the right step. Back / Next buttons move between steps; "Show all steps" lays everything out on one page. Finished consultations keep the read-only record layout.
- Implemented as a `workflow` option of `NoteEditor` (`WorkflowStep`), with `VisitReview` as the last step. Nothing typed is lost when changing step; the Save draft / Sign & lock bar stays visible.

### 2026-10-21 — Lab and X-ray orders open over the consultation
- A test in a consultation's "Tests (lab & X-ray)" list now opens in a window over the consultation (results, imaging report, samples, validation for those allowed) instead of leaving for the Laboratory page; closing it returns to the same step. The lab order page and the window share one component (`components/lab/order-detail.tsx`, `LabOrderDetail`, `embedded` hides the breadcrumb and patient banner, and offers "Open to print" in a new tab).

### 2026-10-21 — Past consultations in full, from inside a consultation
- The History window's "Previous visits" now opens an earlier consultation in full and read-only in the same window (no leaving the current visit): vital signs, signed notes with the integrity check, diagnoses, prescriptions, medicines given, tests (each opens in its own window) and charges. "All earlier visits" returns to the list; "Open on its own page" opens it in a new tab. The "Last seen …" strip has "Open that visit" (straight to the latest earlier consultation) and "All history".

### 2026-10-21 — Admit, surgery, refer from inside a consultation
- The guided visit has a new **Next steps** step (between Treatment and Advice & follow-up): Admit to hospital, Surgery, Refer to a specialist, Book a follow-up visit, or send home. Each option shows what is already arranged (current admission with a link to its treatment sheet, scheduled surgeries, referrals saved in this visit) and opens the usual window over the consultation; saving returns to the consultation instead of jumping to another page (`onAdmitted` / `onScheduled` / `onSaved` on the three dialogs). The admission is linked to the consultation (`encounterId`). Options appear only when the clinic offers the service (hospital, surgery, insurance & referrals modules) and the user holds the permission.
- **Admit** and **Surgery** buttons in the consultation's action bar jump to that step and open the window. The final review lists "Where next" (admitted / surgery scheduled / referred / going home).
- Surgery stays linked to the patient only (starting a surgery creates its own operating record, which replaces any earlier consultation link).

### 2026-10-21 — Past records beside the consultation
- **Past records panel** docked to the right of the visit (the vet reads the earlier entry while writing the new one). Opened by a **Past** button on every note field and by "Past …" buttons in the steps (vitals, problems, diagnoses, tests, medicines given, prescriptions, photos & documents). Tabs: Notes (any of the seven fields, earlier signed notes newest first), Vitals, Problems, Diagnoses, Medicines given, Prescriptions, Tests, Documents & photos. Each tab appears only if the user may see that kind of record.
- **Copying forward**: Notes — "Use this" (replace, with Undo) and "Add to mine"; an empty field also gets "Fill from last visit". Problems — "Add again" for resolved ones; Diagnoses — "Add" to this visit; Prescriptions — "Prescribe again" (new draft attached to this consultation: `POST /prescriptions/:id/repeat` now takes `encounterId`; doses are copied as written, so the vet must check them); Tests — view results in a window or "Order again" (same tests pre-ticked); Documents — thumbnails that open in a new tab.
- Uses the complete-patient-record endpoint (`/patients/:id/record`), so sections follow the user's permissions.
