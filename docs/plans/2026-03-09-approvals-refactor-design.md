# Approvals Refactor Design

## Goal

Refactor the webapp approvals module so that `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts` stops acting as a large god file. The refactor must preserve existing behavior and exported capabilities while splitting the logic into smaller, focused modules, improving type safety, and reducing duplicated query/update code.

## Current Problems

- `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts` mixes public server actions, domain types, effect runtime wiring, entity-specific approval logic, notification side effects, and read-model queries.
- Absence and time-correction flows share orchestration steps, but the file duplicates approval request validation, status updates, and effect plumbing.
- The file still relies on several `any`-typed values, which hides mistakes and makes refactoring harder.
- `getPendingApprovals()` performs per-request entity fetches, causing an avoidable N+1 query pattern.
- Other approval handlers dynamically import the large route-level module, which creates a brittle dependency on a page-oriented file path.

## Chosen Approach

Move the heavy approvals logic into focused modules under the approvals feature, then update dependent callers to import the new modules directly instead of routing everything through the large actions file.

This keeps Next.js server actions easy to expose from the route layer while moving reusable logic into modules that are easier to test, read, and evolve.

## Alternatives Considered

### 1. Thin facade plus sibling modules

Keep `actions.ts` as a compatibility facade and move implementation into sibling modules. This is the lowest-risk option, but it preserves a public dependency on the route-layer file and does not fully clean up imports from the approval handlers.

### 2. Move everything into `src/lib/approvals`

This is the cleanest long-term architecture, but it risks mixing route/server-action semantics with domain logic too aggressively in one pass.

### 3. Split only by entity type

This reduces file size but leaves duplicated workflow plumbing and the N+1 read path intact.

## Proposed Architecture

Create a small approvals server module set next to the existing route:

- `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`
  - public exports only
  - re-exports server actions and query functions from focused modules
- `apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts`
  - approval response types currently declared in `actions.ts`
- `apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.ts`
  - typed approval workflow helper
  - current approver lookup
  - approval request lookup and status update helpers
  - shared tracing and logging helpers
- `apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.ts`
  - approve/reject absence implementations
  - absence-specific fetch/update helpers
  - holiday lookup, email composition, notifications, and calendar sync side effects
- `apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.ts`
  - approve/reject time correction implementations
  - work-period lookup, correction entry lookup, duration recomputation, and notifications
- `apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.ts`
  - pending approvals read model
  - pending approval counts
  - batched entity hydration utilities

## Module Responsibilities

### Public actions layer

`actions.ts` becomes a thin export surface. It should contain only `use server`, imports of the extracted functions, and the backward-compatible exported names.

### Shared workflow module

The shared workflow module owns the common approval pipeline:

1. resolve authenticated session
2. resolve current employee approver
3. validate that a pending approval request exists for that approver
4. update approval request status
5. run entity-specific follow-up effect
6. record tracing and logging
7. return via `runServerActionSafe`

This module should expose narrow typed helpers rather than one large callback with `any` everywhere.

### Absence approval module

Absence-specific code should be decomposed into helpers for:

- updating absence status
- fetching the absence with category, employee, and user relations
- fetching holidays for business-day calculation
- building the approved/rejected email payload
- triggering notifications and calendar sync

The approve and reject functions should reuse shared helpers for date formatting and absence context assembly.

### Time correction module

Time-correction-specific code should be decomposed into helpers for:

- fetching the work period and employee relations
- locating correction entries for clock-in and clock-out
- calculating corrected `endTime` and `durationMinutes`
- applying the corrected entry references to the work period
- triggering approved or rejected notifications

This removes branching noise from the top-level action functions and makes the correction math easier to inspect.

### Query module

`getPendingApprovals()` should stop querying the underlying entity inside a loop. Instead:

1. fetch pending approval requests for the approver
2. split request IDs by entity type
3. fetch all matching absences in one query and all matching work periods in one query
4. map results by ID
5. build the final `absenceApprovals` and `timeCorrectionApprovals` arrays from the request list order

This preserves output shape while reducing query count significantly for busy approval inboxes.

## Data Flow

### Approve/reject path

1. UI invokes exported server action.
2. Public action delegates to the extracted module.
3. Shared approval workflow validates approver and pending request.
4. Entity module performs domain update and side effects.
5. Shared workflow finalizes trace/logging and returns `ServerActionResult<void>`.

### Read path

1. UI requests pending approvals or counts.
2. Query module resolves current employee.
3. Query module runs batched database reads.
4. Query module returns the same view-model structures the current components expect.

## Type Safety Changes

- Replace local `any` usage with explicit relation result types inferred from query helpers.
- Define reusable approver, absence, holiday, work-period, and correction-entry helper result types near the modules that use them.
- Keep external return types unchanged so components and handlers do not need behavioral updates.

## Import Cleanup Plan

Update these direct dependencies to import extracted logic instead of the heavy route file where possible:

- `apps/webapp/src/lib/approvals/handlers/absence-request.handler.ts`
- `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`

The page component at `apps/webapp/src/app/[locale]/(app)/approvals/page.tsx` can continue importing `getCurrentEmployee` from the route-local public entrypoint unless a cleaner shared employee helper naturally emerges.

## Error Handling

- Preserve existing `NotFoundError` and `AuthorizationError` semantics.
- Keep trace status updates centralized in the shared workflow helper.
- Preserve fire-and-forget behavior for notification and calendar-sync side effects.
- Avoid expanding scope into behavior changes such as transactional orchestration unless existing code already requires it.

## Testing And Verification

At minimum, verify the refactor with webapp-focused checks:

- targeted TypeScript validation through the existing app build or test pipeline
- `pnpm test` if coverage is practical for the touched area
- `pnpm build` for final integration confidence if the changed imports affect route compilation

Behavior to verify manually or through existing tests:

- approving an absence still updates status, emails the requester, and enqueues calendar sync
- rejecting an absence still records the rejection reason and sends the rejection email
- approving a time correction still updates the work period and triggers notification
- rejecting a time correction still leaves the period unchanged and triggers rejection notification
- pending approvals and counts still render with the same shapes expected by current UI components

## Non-Goals

- redesigning the approval inbox UI
- changing approval domain rules or notification wording
- migrating all approval logic in the repository into a single new architecture in one pass
- changing tenant scoping behavior beyond preserving existing organization-aware queries

## Implementation Notes

- Keep file moves incremental so each step remains reviewable.
- Favor extraction and helper reuse over deeper architectural rewrites.
- Preserve export names for the public server actions to avoid unnecessary UI churn.
- If additional approval types are added later, the extracted shared workflow should make new modules cheaper to introduce without growing another large file.
