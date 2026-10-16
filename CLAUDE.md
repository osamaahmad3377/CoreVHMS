# CLAUDE.md

Full product brief: `context.md`. Status: `docs/FEATURE_MATRIX.md`. Plan/progress: `docs/IMPLEMENTATION_PLAN.md`.

## Layout
- `packages/shared` — permissions (`permissions.ts`), enums, Zod schemas used by API **and** web forms. Rebuild (`npm run build:shared`) after changes; API and web import `dist/`.
- `apps/api` — NestJS. One folder per module under `src/modules/<name>` (controller = HTTP only, service = rules + transactions). Cross-cutting code in `src/common`.
- `apps/web` — Next.js App Router. Pages in `src/app/(app)/…`, shared UI in `src/components`, API client in `src/lib/api.ts`.

## Rules that must not be broken
- Tenant data goes through `prisma.db` (tenant-scoped). `prisma.raw` only for identity/auth, audit and platform jobs. Validate user-supplied foreign keys belong to the org (scoped `findUnique`).
- Every protected route has `@RequirePermissions(...)` / `@RequireAnyPermission(...)`. New permissions go in `packages/shared/src/permissions.ts` and the relevant role templates.
- Write `AuditService.record(..., tx)` inside the same transaction as the change.
- Money = integer minor units. Time = UTC timestamptz. No hardcoded clinical doses/schedules — configurable data with a source.
- Signed clinical records are never overwritten — amend/addendum only.
- Modules extend shared registries instead of editing other modules: `ClientMergeService.register`, `PatientMergeService.register`, `PatientTimelineService.register`, `SearchService.register`, `DashboardService.register`, `AttachmentsService.registerTarget`.
- Add a nav item in `apps/web/src/lib/navigation.ts` with `ready: true` only when the module works end-to-end.

## Commands
- Migrations: `cd apps/api && npx prisma migrate dev --create-only --name x` then `npx prisma migrate deploy` (`migrate dev` hangs in non-TTY shells).
- Tests: `npm test -w @vcms/shared`, `npm test -w @vcms/api` (integration DB `vcms_test`), `npm run test:e2e -w @vcms/web` (needs running stack + seed).
- Seed demo data: `npm run db:seed` (`-- --reset` to recreate).
