## Overview

Fix the three blockers preventing `dev` from merging into `main`:

1. Replace app auth callback session-token handoff with a short-lived single-use auth code flow.
2. Remove cross-organization employee fallback so employee-scoped behavior is always bound to the active organization.
3. Complete the canonical time-record cutover with an executable backfill and reconciliation path so canonical-only reads are safe.

## Goals

- Keep long-lived session tokens out of custom-scheme callback URLs.
- Ensure employee resolution fails closed when the active organization has no employee row.
- Make canonical payroll and absence reads safe by requiring a real backfill path instead of silently returning incomplete data.

## Non-Goals

- Redesign Better Auth session storage.
- Rework organization membership rules beyond employee-scoped enforcement.
- Replace the canonical time model or restore broad legacy read fallbacks.

## Design

### 1. App Auth Handoff

`/api/auth/app-login` should stop redirecting `session.session.token` in the callback URL.

Instead, it should:

- validate the requested app type and redirect scheme as it does today
- require an authenticated web session
- create a short-lived single-use auth code bound to:
  - the current session token
  - the target app type
  - an expiration timestamp
- redirect to the callback URL with `?code=...`

Add a new exchange endpoint for app clients. The mobile and desktop apps will send the received code plus their app type header, and the server will:

- verify the code exists
- verify it has not expired
- verify it matches the requesting app type
- mark it used atomically so it cannot be replayed
- return the underlying session token only after successful exchange

This preserves the existing app-side token storage model while removing the exposure of the real session token from callback URLs, browser history, and device logs.

### 2. Tenant-Scoped Employee Resolution

`getCurrentEmployee` helpers must become strict to `activeOrganizationId`.

Current behavior:

- try active organization
- if not found, fall back to any active employee row for the user

New behavior:

- if there is no authenticated session, return `null`
- if there is no `activeOrganizationId`, return `null`
- if there is no active employee row for the active organization, return `null`
- never fall back to another organization's employee record

Any action or route that requires an employee record must treat `null` as an authorization or context failure and fail closed.

`/api/organizations/switch` may continue returning `hasEmployeeRecord` for UX, but that flag must never be paired with server-side fallback logic that crosses tenants.

### 3. Canonical Backfill and Reconciliation

The canonical migration introduced canonical-only payroll and absence reads, but the planned executable backfill and reconciliation path was not completed.

Implement the missing cutover path in-repo:

- a backfill function that reads legacy work periods, absence entries, and approval requests
- idempotent writes into canonical tables
- legacy linkage updates through `canonicalRecordId`
- population of `absence_entry.organization_id`
- reconciliation that compares legacy and canonical parity for counts and critical fields

Runtime behavior during cutover should be explicit:

- canonical-only readers must not silently return incomplete results when required legacy linkage/backfill state is missing
- if backfill prerequisites are missing, return a clear operational error so the issue is visible and actionable

This keeps the system safe for production cutover and aligns the codebase with the earlier canonical-time implementation plan.

## Implementation Shape

### Auth

- add storage for one-time auth codes or a server-side code registry integrated with existing persistence patterns
- update `/api/auth/app-login`
- add an app exchange endpoint used by mobile and desktop clients
- update app callback parsing to expect `code` instead of `token`
- update app session bootstrap to exchange code for the real session token before storing it

### Employee Scoping

- update `apps/webapp/src/app/[locale]/(app)/absences/current-employee.ts`
- update `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/auth.ts`
- review employee-dependent consumers and ensure they fail closed on missing employee context

### Backfill

- extend the current backfill module into an executable path, not just a payload builder
- add reconciliation support promised in the prior plan
- wire focused callers or guards where canonical-only reads currently assume the backfill already happened

## Testing

Use TDD for all three areas.

### Auth tests

- route test proves `/api/auth/app-login` redirects with `code`, not `token`
- exchange endpoint tests prove code expiry, single use, and app-type binding
- mobile and desktop app tests prove callback handling exchanges the code and stores the resulting session token

### Tenant-scoping tests

- helper tests prove no employee is returned when active org has no employee row
- route/action tests prove employee-scoped behavior rejects instead of falling back across organizations

### Canonical cutover tests

- backfill tests prove legacy rows populate canonical rows and linkage fields idempotently
- reconciliation tests prove parity reporting catches mismatches
- payroll export and absence query tests prove canonical reads behave correctly once backfill state exists

## Verification

Minimum verification before merge:

- targeted auth route and app-session tests
- targeted employee-scoping tests
- targeted backfill, reconciliation, payroll export, and absence tests
- full `pnpm test`

## Rollout

- implement fixes on `dev`
- rerun verification
- update the open PR to `main`
- merge only after the blockers are resolved and verified

## Risks and Mitigations

- Auth-flow regression risk: mitigate with end-to-end route and client callback tests.
- Tenant enforcement regressions: mitigate by making employee-dependent routes fail closed and verifying with scoped tests.
- Canonical migration operational risk: mitigate by making missing backfill state explicit and by adding reconciliation.
