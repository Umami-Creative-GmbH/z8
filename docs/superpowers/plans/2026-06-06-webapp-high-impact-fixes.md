# Webapp High-Impact Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the eight confirmed high-impact security, multi-tenancy, React correctness, upload hardening, and rate-limit findings in `apps/webapp`.

**Architecture:** Make small targeted changes at each affected boundary. Tenant isolation fixes add explicit `organizationId` predicates and ownership validation before returning or mutating data. React fixes remove hydration and hook-ordering hazards without adding manual memoization unless profiling proves it is needed.

**Tech Stack:** Next.js 16 route handlers, React 19, Better Auth, Drizzle ORM, CASL authorization helpers, Vitest, Biome, `pnpm`.

---

## Scope And Ordering

Implement in this order:

1. Tenant isolation: corrections API, holiday category validation, ICS feed helpers.
2. React correctness: `useSession()` hook ordering, calendar viewport hydration, platform-admin query-param hydration.
3. Upload and rate-limit hardening: generic upload errors, TUS early constraints, API rate-limit coverage.
4. Verification: focused Vitest suites, touched-file Biome checks, source scan.

Do not add manual `useMemo` for Schedule-X event derivation as part of this plan. Treat the previous memoization finding as unconfirmed because React Compiler may optimize it automatically. Only revisit with profiler evidence or a React Doctor finding that remains after these fixes.

## Files To Modify

- `apps/webapp/src/app/api/time-entries/corrections/route.ts`
- `apps/webapp/src/app/api/time-entries/corrections/route.test.ts`
- `apps/webapp/src/app/api/org-admin/holidays/route.ts`
- `apps/webapp/src/app/api/org-admin/holidays/[id]/route.ts`
- `apps/webapp/src/app/api/org-admin/holidays/route.test.ts`
- `apps/webapp/src/app/api/org-admin/holidays/[id]/route.test.ts`
- `apps/webapp/src/app/api/calendar/ics/[secret]/route.ts`
- `apps/webapp/src/app/api/calendar/ics/[secret]/route.test.ts`
- `apps/webapp/src/lib/auth-client.ts`
- `apps/webapp/src/lib/auth-client.test.tsx`
- `apps/webapp/src/components/calendar/calendar-view.tsx`
- `apps/webapp/src/components/calendar/calendar-view.test.tsx`
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.tsx`
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx`
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx`
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx`
- `apps/webapp/src/app/api/upload/process/route.ts`
- `apps/webapp/src/app/api/upload/process/route.test.ts`
- `apps/webapp/src/app/api/tus/[[...path]]/route.ts`
- `apps/webapp/src/app/api/tus/[[...path]]/route.test.ts`
- `apps/webapp/src/proxy.ts`
- `apps/webapp/src/app/api/auth/app-exchange/route.ts`
- `apps/webapp/src/app/api/auth/app-login/route.ts`
- `apps/webapp/src/app/api/discord/setup/route.ts`
- `apps/webapp/src/app/api/telegram/setup/route.ts`
- Matching route tests for the rate-limited endpoints.

## Task 1: Fix Correction History Tenant Isolation

**Files:**
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.ts:211-257`
- Create: `apps/webapp/src/app/api/time-entries/corrections/route.test.ts`

- [ ] Write failing tests that prove correction queries include `eq(timeEntry.organizationId, activeOrgId)` and `entryId` lookup rejects entries outside the active org.
- [ ] Run `pnpm vitest run src/app/api/time-entries/corrections/route.test.ts`; expect failure before implementation.
- [ ] Initialize GET query conditions with `eq(timeEntry.type, "correction")` and `eq(timeEntry.organizationId, activeOrgId)`.
- [ ] Change original entry lookup to `where(and(eq(timeEntry.id, entryId), eq(timeEntry.organizationId, activeOrgId)))`.
- [ ] Before accepting `employeeId`, query `employee` by `id`, `organizationId`, and `isActive`; return 404 when not found.
- [ ] Preserve existing CASL check for non-self employee reads.
- [ ] Run `pnpm vitest run src/app/api/time-entries/corrections/route.test.ts`; expect pass.

## Task 2: Validate Holiday Category Ownership

**Files:**
- Modify: `apps/webapp/src/app/api/org-admin/holidays/route.ts:93-126`
- Modify: `apps/webapp/src/app/api/org-admin/holidays/[id]/route.ts:49-80`
- Create: `apps/webapp/src/app/api/org-admin/holidays/route.test.ts`
- Create: `apps/webapp/src/app/api/org-admin/holidays/[id]/route.test.ts`

- [ ] Write POST and PATCH tests where `categoryId` exists but `holidayCategory.organizationId !== activeOrgId`; expect 400 `{ error: "Invalid holiday category" }` and no insert/update.
- [ ] Run `pnpm vitest run src/app/api/org-admin/holidays/route.test.ts src/app/api/org-admin/holidays/[id]/route.test.ts`; expect failure.
- [ ] Import `holidayCategory` in both route files.
- [ ] Before POST insert, query `holidayCategory` by `id` and `organizationId`; return 400 when absent.
- [ ] Before PATCH update, run the same check only when `categoryId` is provided.
- [ ] Change PATCH update predicate to `where(and(eq(holiday.id, id), eq(holiday.organizationId, activeOrgId)))`.
- [ ] Re-run the holiday tests and touched-file Biome checks; expect pass.

## Task 3: Org-Scope Public ICS Feed Helpers

**Files:**
- Modify: `apps/webapp/src/app/api/calendar/ics/[secret]/route.ts:80-234`
- Create: `apps/webapp/src/app/api/calendar/ics/[secret]/route.test.ts`

- [ ] Write user-feed and team-feed tests that inspect mocked query predicates and assert `feed.organizationId` is used for employee, team, absence, and category queries.
- [ ] Run `pnpm vitest run 'src/app/api/calendar/ics/[secret]/route.test.ts'`; expect failure.
- [ ] Pass `feed.organizationId` into `fetchEmployeeAbsences` and `fetchTeamAbsences`.
- [ ] Scope `db.query.employee.findFirst` by `employee.id` and `employee.organizationId`.
- [ ] Scope `db.query.team.findFirst` by `team.id` and `team.organizationId`.
- [ ] Scope `teamEmployees` lookup by `employee.teamId` and `employee.organizationId`.
- [ ] Add org predicates to absence queries: `absenceEntry.organizationId`, joined `employee.organizationId`, and joined `absenceCategory.organizationId`.
- [ ] Re-run the ICS tests and touched-file Biome check; expect pass.

## Task 4: Fix `useSession()` Hook Ordering

**Files:**
- Modify: `apps/webapp/src/lib/auth-client.ts:99-113`
- Create or modify: `apps/webapp/src/lib/auth-client.test.tsx`

- [ ] Add a regression test or source test that prevents an early return before `client.useSession()`.
- [ ] Run `pnpm exec biome check src/lib/auth-client.ts`; expect current failure `lint/correctness/useHookAtTopLevel`.
- [ ] Refactor `useSession()` to call the client hook unconditionally for client-only use: `return requireAuthClient().useSession();`.
- [ ] Run `pnpm exec biome check src/lib/auth-client.ts` and `pnpm vitest run src/lib/auth-client.test.tsx`; expect pass.

## Task 5: Fix Calendar Viewport Hydration Risk

**Files:**
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx:49-93`
- Create or modify: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] Add a regression test that blocks `window.matchMedia` from being used inside the `useState` initializer. If full rendering is feasible, test mobile `matchMedia` still starts from stable SSR state and switches after effects.
- [ ] Run `pnpm vitest run src/components/calendar/calendar-view.test.tsx`; expect failure before implementation.
- [ ] Remove `getInitialViewMode()`.
- [ ] Initialize `viewMode` with a stable value: `useState<ViewMode>("week")`.
- [ ] Add a mount-only `useEffect` that switches to `"day"` when `window.matchMedia("(max-width: 767px)").matches`.
- [ ] Run the calendar test and `pnpm exec biome check src/components/calendar/calendar-view.tsx`; expect pass.

## Task 6: Fix Platform Admin Query-Param Hydration Risk

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.tsx:65-94`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx:66-105`
- Create or modify page tests if practical.

- [ ] Add tests that prevent `window.location.search` reads in both pages.
- [ ] Run the matching page tests; expect failure before implementation.
- [ ] Replace render-time `getInitialFilters()` usage with stable defaults for `search`, `status`, and other filter state.
- [ ] Use `useSearchParams()` and a post-hydration `useEffect` to sync URL search/status values into state.
- [ ] Preserve each page's exact filter unions and valid status values.
- [ ] If Next build reports a Suspense bailout issue, split each page into a Suspense wrapper plus client body using the existing skeleton/loading UI.
- [ ] Run touched page tests and `pnpm exec biome check` for both page files; expect pass.

## Task 7: Harden Upload Processing And TUS Early Validation

**Files:**
- Modify: `apps/webapp/src/app/api/upload/process/route.ts:182-187`
- Create: `apps/webapp/src/app/api/upload/process/route.test.ts`
- Modify: `apps/webapp/src/app/api/tus/[[...path]]/route.ts:31-39`
- Modify: `apps/webapp/src/app/api/tus/[[...path]]/route.test.ts`

- [ ] Write an upload-process test that forces an internal storage error containing sensitive detail and expects response body `{ error: "Processing failed" }` with no `details` field.
- [ ] Run `pnpm vitest run src/app/api/upload/process/route.test.ts`; expect failure.
- [ ] Remove `details: String(error)` from the JSON response while keeping server-side logging.
- [ ] Extend TUS tests to reject oversized POST upload creation requests using `upload-length`.
- [ ] Extend TUS tests to reject invalid upload metadata content types when metadata contains a recognized base64 content-type entry.
- [ ] In `route.ts`, add `MAX_TUS_UPLOAD_SIZE = 10 * 1024 * 1024` and allowed MIME types matching `upload/process/route.ts`.
- [ ] Add `validateTusUploadRequest(request)` and call it in `withAuth()` before `tusServer.handleWeb(request)` for `POST` requests.
- [ ] Run upload and TUS tests plus touched-file Biome checks; expect pass.

## Task 8: Add Explicit Rate Limits To API Routes Excluded From Proxy

**Files:**
- Modify: `apps/webapp/src/proxy.ts:90-109`
- Modify: `apps/webapp/src/app/api/auth/app-exchange/route.ts:16-38`
- Modify: `apps/webapp/src/app/api/auth/app-login/route.ts:38-81`
- Modify: `apps/webapp/src/app/api/discord/setup/route.ts:25-75`
- Modify: `apps/webapp/src/app/api/telegram/setup/route.ts:29-44`
- Create or modify matching route tests.

- [ ] Write tests for each endpoint that mock `checkRateLimit()` as disallowed and expect a 429 response from `createRateLimitResponse()`.
- [ ] Run the route tests; expect failure where explicit checks are missing.
- [ ] Import `checkRateLimit`, `createRateLimitResponse`, and `getClientIp` in each route.
- [ ] Add a rate-limit check before parsing credentials, creating auth codes, consuming auth codes, or verifying integration tokens.
- [ ] Use endpoint `"auth"` for app auth-code exchange/login.
- [ ] Use endpoint `"api"` for Discord and Telegram setup unless a narrower integration endpoint already exists in `RateLimitEndpoint`.
- [ ] Update `proxy.ts` comments so they do not imply API routes are covered when the matcher excludes `api`.
- [ ] Run all rate-limit route tests and touched-file Biome checks; expect pass.

## Final Verification

- [ ] Run all focused tests added or modified by this plan:

```bash
pnpm vitest run \
  src/app/api/time-entries/corrections/route.test.ts \
  src/app/api/org-admin/holidays/route.test.ts \
  src/app/api/org-admin/holidays/[id]/route.test.ts \
  'src/app/api/calendar/ics/[secret]/route.test.ts' \
  src/lib/auth-client.test.tsx \
  src/components/calendar/calendar-view.test.tsx \
  'src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx' \
  'src/app/[locale]/(admin)/platform-admin/users/page.test.tsx' \
  src/app/api/upload/process/route.test.ts \
  'src/app/api/tus/[[...path]]/route.test.ts' \
  src/app/api/auth/app-exchange/route.test.ts \
  src/app/api/auth/app-login/route.test.ts \
  src/app/api/discord/setup/route.test.ts \
  src/app/api/telegram/setup/route.test.ts
```

- [ ] Run touched-file Biome checks:

```bash
pnpm exec biome check \
  src/app/api/time-entries/corrections/route.ts \
  src/app/api/org-admin/holidays/route.ts \
  'src/app/api/org-admin/holidays/[id]/route.ts' \
  'src/app/api/calendar/ics/[secret]/route.ts' \
  src/lib/auth-client.ts \
  src/components/calendar/calendar-view.tsx \
  'src/app/[locale]/(admin)/platform-admin/organizations/page.tsx' \
  'src/app/[locale]/(admin)/platform-admin/users/page.tsx' \
  src/app/api/upload/process/route.ts \
  'src/app/api/tus/[[...path]]/route.ts' \
  src/proxy.ts \
  src/app/api/auth/app-exchange/route.ts \
  src/app/api/auth/app-login/route.ts \
  src/app/api/discord/setup/route.ts \
  src/app/api/telegram/setup/route.ts
```

- [ ] Run a focused source scan:

```bash
pnpm exec biome check src --reporter=summary
```

Expected: no new diagnostics from touched files. Existing unrelated diagnostics may remain; document them in the completion summary instead of fixing unrelated files.

## Implementation Notes

- Use `pnpm` only.
- Do not edit `src/db/auth-schema.ts` directly.
- Do not remove or revert unrelated worktree changes.
- Do not commit unless the user explicitly requests it.
- Keep every tenant data query organization-scoped.
- For time-tracking code, preserve UTC canonical storage and per-entry timezone fields; this plan only changes query scoping, not time semantics.
