# Clockin Client Hardening Design

## Summary

Treat the next untouched `Clockin` import track as a narrow review-and-hardening slice around the existing `Clockin` provider client contract rather than a fresh implementation of Task 3 from `docs/plans/2026-03-11-clockin-import-implementation-plan.md`.

The current repository already contains the planned Task 3 files and several later Clockin import layers, so the safest parallel work is to validate and tighten the provider boundary without overlapping action, orchestrator, or UI work.

## Context

- The user asked for an untouched parallel feature and then narrowed scope to "only 3" from the Clockin import plan because Tasks 1 and 2 are being handled by other agents.
- The original implementation plan defines Task 3 as the Clockin provider types and API client.
- In the current checkout, the Clockin implementation is already present beyond Task 3.

Relevant existing files:

- `apps/webapp/src/lib/clockin/client.ts`
- `apps/webapp/src/lib/clockin/types.ts`
- `apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.ts`
- `apps/webapp/src/lib/clockin/import-orchestrator.ts`
- `apps/webapp/src/components/settings/clockin-import/clockin-import-wizard.tsx`

Recent commit evidence:

- `08705a8 feat(settings): add clockin import hub`
- `2f1c633 fix(webapp): unblock typed production build`

## Goal

Audit and harden the existing `Clockin` client and type contract so downstream import work can rely on a stable provider boundary.

## Non-Goals

- Do not redesign the shared import hub.
- Do not add duplicate-detection logic.
- Do not modify server-action authorization or organization-scoping behavior except for narrow contract fixes forced by client changes.
- Do not rewrite the existing Clockin wizard.
- Do not introduce a generic multi-provider import abstraction.
- Do not add recurring sync or background job behavior.

## Approved Direction

Use the existing Task 3 boundary as a review-and-hardening slice:

- keep work centered on `apps/webapp/src/lib/clockin/client.ts`
- keep `apps/webapp/src/lib/clockin/types.ts` minimal and provider-oriented
- allow only narrow downstream edits when required to keep the existing client callers compiling against the tightened contract

This keeps the work parallelizable and avoids stepping on other agents who may be touching entry routing, hub wiring, or broader Clockin import behavior.

## Approaches Considered

### 1. Harden the existing Clockin client contract in place (selected)

Review the current provider client, confirm the request contract, tighten error handling and pagination behavior, and leave the rest of the import stack alone unless a small caller adjustment is required.

Pros:

- Minimal overlap with active work.
- Directly improves the shared provider boundary that later import layers depend on.
- Keeps risk low by avoiding a rewrite of already-present code.

Cons:

- Smaller product-visible impact than building a new surface.
- May reveal follow-up work in later layers without addressing it in this slice.

### 2. Re-implement Task 3 from scratch as originally planned

Replace the current client and types with a fresh implementation that strictly follows the older plan.

Pros:

- Cleanest reset if the existing client were badly structured.

Cons:

- Unnecessary churn because the files already exist.
- Higher overlap risk with actions and orchestrator code already built on top.
- More likely to break downstream code for limited value.

### 3. Expand the slice to include actions and orchestrator fixes

Treat the current Clockin implementation as one combined stabilization track.

Pros:

- Could resolve more end-to-end issues in one pass.

Cons:

- No longer matches the user constraint to do only Task 3.
- Higher collision risk with other agents.
- Larger verification surface.

## Architecture

The hardened provider boundary should remain split across two files.

### `apps/webapp/src/lib/clockin/types.ts`

Responsibilities:

- define raw Clockin response shapes
- define paginated response metadata
- define narrow search-request payload types used by the client

Rules:

- keep the types provider-facing, not Z8-domain-facing
- include only fields needed for connection checks, employee mapping, workday import, absence import, and schedule-related import readiness
- avoid embedding organization, authorization, mapping, or duplicate-detection concerns here

### `apps/webapp/src/lib/clockin/client.ts`

Responsibilities:

- own the Clockin base URL
- send bearer-authenticated JSON requests
- encapsulate provider-specific request and response details
- expose small explicit methods such as:
  - `testConnection()`
  - `getEmployees()`
  - `searchWorkdays(...)`
  - `searchAbsences(...)`
  - any additional schedule-focused method only if the existing importer truly needs it

Rules:

- follow the repo's existing provider-specific pattern used by `ClockodoClient`
- do not introduce a shared provider superclass or generic import abstraction
- keep pagination and query-shape quirks inside the client
- keep org scoping, authorization, and DB logic outside this layer

## Data Flow

Expected flow after hardening:

1. A server action creates `ClockinClient` from the admin-supplied token.
2. The action calls `testConnection()` and lightweight fetch methods for preview and mapping.
3. Later import orchestration calls the same explicit client methods for provider reads.
4. Mapping, duplicate skipping, org ownership checks, and writes remain outside the client.

This preserves a clean boundary between provider access and application logic.

## Error Handling

The hardening slice should verify and, if needed, improve these behaviors:

- bearer auth failures return clear provider error messages
- malformed or non-JSON responses fail predictably
- empty results are treated as valid empty data, not errors
- pagination is handled correctly where the provider returns multiple pages
- unsupported areas, such as schedules if still unwired, are represented explicitly rather than implied by placeholder counts

The client should fail loudly enough for operators and tests to understand what broke, but without leaking unrelated application concerns into the provider layer.

## Testing Strategy

Keep verification focused on the client boundary.

### Unit tests

`apps/webapp/src/lib/clockin/client.test.ts` should cover:

- request headers, method, and request-body shape
- `testConnection()` behavior for success and auth failure
- employee fetch behavior
- workday and absence search payload structure
- pagination behavior if the provider endpoints return multiple pages
- malformed-response and non-OK response handling

### Out of scope for this slice

- DB-backed import tests
- org permission tests beyond existing caller coverage
- wizard progression tests
- duplicate-detection behavior

## Delivery Boundary

This design intentionally narrows the next parallel work item to:

- review the existing Clockin client and types
- tighten the provider contract where needed
- keep downstream edits minimal and strictly compatibility-driven

If review shows the current client contract is already sound, the outcome of the slice can be a no-op implementation with stronger evidence from tests and code review rather than broader feature work.
