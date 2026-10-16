# Project Audit — NextCore VCMS

**Audit date:** 2026-10-14
**Scope:** `/Users/appleone/Desktop/COREVET` at the start of implementation.

## 1. Repository state

| Item | Finding |
|---|---|
| Source code | None. The directory held only `context.md` (the master development prompt). |
| Version control | Not a Git repository. `git init` was run; no commits were made. |
| Package configuration | None. |
| Database schema / migrations | None. |
| Authentication, routes, UI components | None. |
| Deployment / CI configuration | None. |

**Conclusion:** this is a **new project**. There is no existing functionality to preserve and there are no conventions to inherit. The project structure and architecture are established from scratch (see `IMPLEMENTATION_PLAN.md`).

## 2. Development environment

| Tool | Version found | Notes |
|---|---|---|
| Node.js | 20.10.0 | Meets Next.js 14 / NestJS 10 / Prisma 5 requirements. Nest 11 and Next 15+ would need a newer Node toolchain for some features, so the stable 14/10/5 lines were chosen. |
| npm | 10.2.3 | npm workspaces are used (pnpm/yarn are not installed). |
| Docker | 24.0.6 (Docker Desktop) | Daemon was stopped and was started for development. ~7.6 GiB RAM allocated. |
| PostgreSQL | not installed locally | Runs in Docker (`postgres:16-alpine`). |
| Homebrew, Git, Python 3.12 | present | — |
| Free disk | ~25 GiB (94% used) | Adequate, but keep Docker image/volume usage modest. Playwright browser downloads (~400 MB) are deferred until E2E tests are added. |

## 3. Risks identified at audit time

1. **Scope.** The prompt describes 25 navigation areas and 10 milestones. A single session cannot deliver all of them to the Definition of Done. Mitigation: build a reusable foundation (tenant-scoped data access, permissions, audit, forms, tables) so each module is cheap, and deliver modules in milestone order with honest status in `FEATURE_MATRIX.md`.
2. **Clinical safety.** Dosage calculations, vaccination schedules and reference intervals must not be invented. Mitigation: these are modelled as configurable data with a mandatory `source`/`reviewedBy` field; seed data is clearly labelled demo data, not clinical guidance.
3. **External services** (SMS, WhatsApp, payments, speech-to-text, AI, lab analyzers) have no credentials. Mitigation: adapter interfaces with clearly labelled development mocks; nothing is described as integrated until tested against the real service.
4. **Offline/desktop.** Not implemented in the first milestones. The domain layer is kept independent of transport so an offline sync layer can be added later; the UI does not claim offline capability.
5. **Regulatory.** Pakistan and Australia privacy/veterinary record-keeping obligations have not been legally reviewed. The system provides mechanisms (audit trails, retention settings, export, amendment-not-overwrite) but compliance must be validated per deployment.

## 4. Security baseline decisions

- Server-side permission checks on every protected endpoint; the UI hides actions as a convenience only.
- Tenant isolation enforced in the data-access layer (Prisma extension injects `organizationId` into every tenant-model query) **and** covered by isolation tests.
- Opaque, hashed session tokens in `HttpOnly`, `SameSite=Lax` cookies; double-submit CSRF token on state-changing requests.
- Argon2id password hashing; rate-limited authentication endpoints; optional TOTP MFA.
- Secrets only in environment variables (`.env` is git-ignored; `.env.example` documents keys without values).
