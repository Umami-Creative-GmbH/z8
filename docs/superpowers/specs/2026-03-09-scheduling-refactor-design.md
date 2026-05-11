# Scheduling Refactor Design

**Goal:** Split the scheduling webapp's heavy server and client modules into focused files, remove duplicated logic, and harden shift deletion authorization without changing intended user-facing behavior.

**Recommended approach:** Use an incremental refactor. Keep the existing public action barrel and component entrypoints stable, extract pure helpers and focused hooks/components around them, and add the authorization fix at the action/service boundary so the UI does not need to understand security policy.

## Scope

- Keep the scheduling route and current imports working.
- Continue the refactor beyond `apps/webapp/src/app/[locale]/(app)/scheduling/actions.ts` into the main scheduling UI files.
- Fix the pre-existing `deleteShift` authorization hole.
- Preserve multi-tenant boundaries and existing manager-vs-employee behavior.

## Decisions

### 1. Server action structure

- Keep `apps/webapp/src/app/[locale]/(app)/scheduling/actions.ts` as the public barrel.
- Keep shared effect helpers in `apps/webapp/src/app/[locale]/(app)/scheduling/actions/shared.ts`.
- Continue using focused action modules by domain: templates, shifts, shift requests, and locations.

This keeps import paths stable for the rest of the webapp while letting server logic evolve in smaller files.

### 2. Shift deletion policy

- Draft shift deletion must require a manager or admin.
- The acting employee must belong to the same organization as the shift.
- Published shifts remain non-deletable through the current flow.

This matches the rest of scheduling management behavior and closes the current path where any employee record can delete a draft shift by id.

### 3. Scheduler UI refactor

Refactor `apps/webapp/src/components/scheduling/scheduler/shift-scheduler.tsx` into:

- pure date/event utilities
- focused query and mutation hooks
- small presentational pieces for publish/compliance state and calendar orchestration

The container should keep only screen-level state and component composition.

### 4. Shift dialog refactor

Refactor `apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx` into:

- a form-state hook for defaults, resets, and template autofill
- query hooks for employees, locations, and skill validation
- smaller UI sections for assignment, schedule details, location/subarea, notes, and destructive actions

This reduces file size, isolates side effects, and makes future behavior changes easier to test.

## Data flow

### Delete flow

1. Client dialog requests deletion through existing action import.
2. Scheduling action loads current employee context.
3. Shift service loads the target shift and verifies org match.
4. Service enforces manager/admin-only deletion for draft shifts.
5. On success, client invalidates scheduling queries exactly as today.

### Scheduler and dialog flow

- Existing TanStack Query keys stay intact.
- Extracted hooks wrap existing actions rather than inventing a new client API.
- Presentational components receive normalized data and callbacks instead of reaching into server actions directly.

## Testing strategy

- Add focused tests for shift deletion authorization:
  - manager/admin in same org can delete draft shifts
  - employee cannot delete draft shifts
  - cross-org deletion is rejected
  - published shifts are rejected
- Keep `apps/webapp/src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts` passing.
- Prefer small unit tests for extracted helpers/hooks where practical.
- Use package typecheck as a regression signal only for new scheduling errors, since unrelated pre-existing failures already exist elsewhere in the webapp.

## Risks and mitigations

- **Behavior drift during UI split:** extract pure helpers first, then move hook logic, then trim the parent component.
- **Security regression:** enforce deletion rules in the service, not only in the UI.
- **Query cache breakage:** keep existing query keys and invalidation points unchanged.

## Success criteria

- Scheduling action imports remain stable.
- The scheduler and shift dialog are split into logical files with less duplicated logic.
- `deleteShift` requires manager/admin access in the same organization.
- Scheduling-specific verification passes without introducing new scheduling type errors.
