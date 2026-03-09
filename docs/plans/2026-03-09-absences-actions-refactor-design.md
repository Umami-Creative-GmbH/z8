# Absences Actions Refactor Design

## Objective

Refactor `apps/webapp/src/app/[locale]/(app)/absences/actions.ts` into smaller, focused modules that preserve all current behavior while improving readability, reuse, and maintainability for the webapp.

## Scope

In scope:

- Keep `apps/webapp/src/app/[locale]/(app)/absences/actions.ts` as the stable public server-action facade.
- Split the current mixed file into logical internal modules for workflow, queries, current-employee lookup, and mapping helpers.
- Deduplicate shared absence-to-domain mapping logic.
- Simplify repeated request-absence workflow branches without changing outcomes.
- Keep all current callers working, including `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts` and absences UI components.

Out of scope:

- Product behavior changes.
- Route/API changes.
- Schema changes.
- Cross-domain architecture rewrites outside the absences webapp flow.

## Confirmed Decisions

- Preserve the current public API by keeping imports stable through `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`.
- Refactor behind that facade into adjacent internal modules.
- Favor low-risk optimizations only: deduplication, smaller helpers, clearer branching, and explicit shared query/mapping code.

## Approaches Considered

### A) Thin facade plus internal modules (Selected)

Keep `actions.ts` as the only public entrypoint and move implementation details into nearby internal files.

Pros:

- Lowest migration risk.
- No caller churn.
- Easy review and rollback.
- Supports incremental follow-up cleanup later.

Cons:

- Still keeps some app-layer logic near the route segment instead of moving all reusable code to `src/lib`.

### B) Move most logic to `src/lib/absences/*`

Turn the app-layer file into a very small wrapper over shared library modules.

Pros:

- Stronger long-term layering.
- Better reuse across pages/features.

Cons:

- Broader blast radius.
- More import churn.
- Higher risk for a first refactor.

### C) Minimal extraction of only the request workflow

Extract `requestAbsenceEffect` and leave the rest mostly unchanged.

Pros:

- Very safe.
- Smallest immediate diff.

Cons:

- Leaves duplicated mapping/query logic in place.
- Does not sufficiently address the current file's mixed responsibilities.

## Architecture

- `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
  - Public facade only.
  - Re-export the existing API surface.
- `apps/webapp/src/app/[locale]/(app)/absences/current-employee.ts`
  - Shared current employee lookup.
  - Keeps active-organization fallback behavior unchanged.
- `apps/webapp/src/app/[locale]/(app)/absences/queries.ts`
  - Read-side helpers: vacation balance, absence entries, holidays, categories, cancel request.
- `apps/webapp/src/app/[locale]/(app)/absences/mappers.ts`
  - Shared mapping from Drizzle absence records with category relation into `AbsenceWithCategory`.
- `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`
  - The request workflow entrypoint plus small internal helpers for validation, persistence, approval handling, and notifications.

## Data Flow

### Read-side helpers

1. `page.tsx` and other callers continue importing from `./actions`.
2. `actions.ts` re-exports helpers from internal modules.
3. Query helpers fetch data from Drizzle and use shared mappers before returning domain types.

### Request absence workflow

1. Authenticate the current session and resolve the current employee.
2. Validate date ordering and same-day half-day rules.
3. Load overlapping absences and category metadata.
4. Create the pending absence row.
5. Branch into one of three paths:
   - requires approval with manager -> create approval request, render/send emails, trigger notifications.
   - does not require approval -> auto-approve and queue calendar sync.
   - requires approval but no manager -> auto-approve and queue calendar sync.
6. Preserve OTEL span attributes, logging, and server-action result handling.

## Refactoring Targets

- Replace duplicated `AbsenceWithCategory` mapping in `getVacationBalance` and `getAbsenceEntries` with one helper.
- Replace repeated inline auto-approval DB updates with a shared helper.
- Replace repeated date formatting closure inside the request workflow with a small utility.
- Reduce the top-level workflow body by extracting named operations with focused responsibilities.
- Keep parallel fetches where already safe, such as `Promise.all` for independent reads and `Effect.all` for independent emails/query lookups.

## Error Handling

- Preserve existing Effect error types and messages for validation, not found, and conflict paths.
- Preserve OTEL exception recording and span status handling.
- Preserve existing fire-and-forget notification and calendar sync behavior.
- Avoid introducing new thrown error shapes from public actions.

## Multi-Tenant and Permission Constraints

- Keep employee and organization scoping identical to current behavior.
- Do not widen access in shared helpers.
- Preserve `canCancelAbsence` checks and current employee resolution behavior.

## Testing Strategy

### Targeted verification

- Run targeted webapp validation for the refactored absences files.
- Confirm `apps/webapp/src/app/[locale]/(app)/absences/page.tsx` still builds against the public facade.
- Confirm `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts` still imports `getCurrentEmployee` successfully.

### Regression focus

- `requestAbsence` still returns the same server-action result shape.
- `getVacationBalance`, `getAbsenceEntries`, `getHolidays`, `getAbsenceCategories`, and `cancelAbsenceRequest` keep their existing return contracts.
- No changes to approval, email, notification, or calendar-sync triggers beyond code movement.

## Risks and Mitigations

- Risk: accidental import-cycle introduction while splitting files.
  - Mitigation: keep helpers one-directional and let `actions.ts` only re-export.
- Risk: changing error behavior while extracting helpers.
  - Mitigation: preserve existing public functions and move logic in small pieces.
- Risk: hidden coupling from external imports.
  - Mitigation: keep `actions.ts` as the stable facade and verify known callers.

## Success Criteria

- `apps/webapp/src/app/[locale]/(app)/absences/actions.ts` becomes a thin facade.
- Request-absence workflow logic is substantially smaller and easier to scan.
- Shared absence mapping logic lives in one place.
- Existing imports in the webapp continue to work unchanged.
- Verification passes with no behavior changes.
