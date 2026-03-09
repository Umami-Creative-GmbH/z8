# Approvals Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the heavy approvals server-action file into focused modules, preserve existing behavior, and reduce duplicated logic and N+1 queries in the webapp approvals flow.

**Architecture:** Keep `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts` as the route-facing public surface, but move orchestration, entity-specific logic, and read-model queries into `apps/webapp/src/app/[locale]/(app)/approvals/_server/*`. Update approval handlers to import the extracted modules directly where reuse makes sense, and add focused tests around the shared helpers and public action exports.

**Tech Stack:** Next.js app router server actions, TypeScript, Effect, Drizzle ORM, Vitest, OpenTelemetry.

---

### Task 1: Create the approvals server module skeleton

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`

**Step 1: Write the failing export smoke test**

Create `apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts` with a simple import test that asserts the public exports still exist after the split.

```ts
import { describe, expect, it } from "vitest";

const actions = await import("./actions");

describe("approvals actions exports", () => {
  it("preserves the public approvals API", () => {
    expect(typeof actions.approveAbsence).toBe("function");
    expect(typeof actions.rejectAbsence).toBe("function");
    expect(typeof actions.approveTimeCorrection).toBe("function");
    expect(typeof actions.rejectTimeCorrection).toBe("function");
    expect(typeof actions.getPendingApprovals).toBe("function");
    expect(typeof actions.getPendingApprovalCounts).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails or is missing coverage**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts"`
Expected: fail because the new test file does not exist yet, or fail once added before the split is complete.

**Step 3: Add the new module files with initial extracted types and exports**

Move the two approval view-model interfaces into `apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts` and re-export them from `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`.

**Step 4: Reduce `actions.ts` to imports and re-exports only**

Update `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts` so it keeps `"use server"` and re-exports the extracted action/query functions instead of owning the full implementation.

**Step 5: Run the export test again**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts"`
Expected: PASS.

**Step 6: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/approvals/actions.ts" "apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server"
git commit -m "refactor: split approvals action module skeleton"
```

### Task 2: Extract and type the shared approval workflow

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.test.ts`

**Step 1: Write the failing shared helper tests**

Create `apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.test.ts` with tests for the pure helper pieces you can isolate first, such as status mapping and approval update payload generation.

```ts
import { describe, expect, it } from "vitest";
import { getApprovalStatusUpdate } from "./shared";

describe("getApprovalStatusUpdate", () => {
  it("builds approved status payload", () => {
    const result = getApprovalStatusUpdate("approve", undefined);
    expect(result.status).toBe("approved");
    expect(result.rejectionReason).toBeUndefined();
  });

  it("builds rejected status payload", () => {
    const result = getApprovalStatusUpdate("reject", "missing details");
    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toBe("missing details");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.test.ts"`
Expected: FAIL with missing helper export.

**Step 3: Implement typed shared helpers**

In `apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.ts`, extract:

- approval action and entity type aliases
- `getApprovalStatusUpdate(action, rejectionReason)`
- typed current approver lookup helper
- typed pending approval request lookup helper
- `processApproval()` with tracing, logging, and `runServerActionSafe`

Avoid `any`; introduce local query result types in `apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts` where inference is too noisy.

**Step 4: Run the shared test again**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.test.ts"`
Expected: PASS.

**Step 5: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.test.ts"
git commit -m "refactor: extract shared approvals workflow"
```

### Task 3: Extract absence approval logic into a dedicated module

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.test.ts`

**Step 1: Write the failing absence helper test**

Add a focused pure-helper test around date formatting or email payload assembly in `apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { formatAbsenceDateForEmail } from "./absence-approvals";

describe("formatAbsenceDateForEmail", () => {
  it("formats dates for absence emails", () => {
    expect(formatAbsenceDateForEmail(new Date("2026-03-09T00:00:00.000Z"))).toBe("Mar 9, 2026");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.test.ts"`
Expected: FAIL with missing helper.

**Step 3: Extract absence-specific helpers and actions**

Implement in `apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.ts`:

- `approveAbsenceEffect(absenceId)`
- `rejectAbsenceEffect(absenceId, reason)`
- absence fetch/update helpers
- holiday fetch helper
- shared absence email context builder
- email send + notification + calendar sync orchestration

Have both exported functions delegate to the shared `processApproval()` helper.

**Step 4: Re-export the absence functions from `actions.ts`**

Keep public names unchanged:

- `approveAbsenceEffect`
- `rejectAbsenceEffect`
- `approveAbsence`
- `rejectAbsence`

**Step 5: Run the new absence test**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.test.ts"`
Expected: PASS.

**Step 6: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.test.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts" "apps/webapp/src/app/[locale]/(app)/approvals/actions.ts"
git commit -m "refactor: extract absence approval actions"
```

### Task 4: Extract time correction approval logic into a dedicated module

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.test.ts`

**Step 1: Write the failing duration helper test**

Create `apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { calculateCorrectedDurationMinutes } from "./time-correction-approvals";

describe("calculateCorrectedDurationMinutes", () => {
  it("returns minutes when corrected clock-in and clock-out exist", () => {
    const result = calculateCorrectedDurationMinutes(
      new Date("2026-03-09T09:00:00.000Z"),
      new Date("2026-03-09T17:30:00.000Z"),
    );
    expect(result).toBe(510);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.test.ts"`
Expected: FAIL with missing helper.

**Step 3: Extract time-correction logic**

Implement in `apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.ts`:

- `approveTimeCorrectionEffect(workPeriodId)`
- `rejectTimeCorrectionEffect(workPeriodId, reason)`
- typed work-period fetch helper
- correction-entry lookup helpers
- `calculateCorrectedDurationMinutes(start, end)`
- work-period update helper
- approval/rejection notification helpers

Have the two exported functions delegate to shared `processApproval()`.

**Step 4: Re-export the time-correction functions from `actions.ts`**

Keep public names unchanged:

- `approveTimeCorrectionEffect`
- `rejectTimeCorrectionEffect`
- `approveTimeCorrection`
- `rejectTimeCorrection`

**Step 5: Run the time-correction test**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.test.ts"`
Expected: PASS.

**Step 6: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.test.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts" "apps/webapp/src/app/[locale]/(app)/approvals/actions.ts"
git commit -m "refactor: extract time correction approval actions"
```

### Task 5: Batch the pending approvals read path and preserve output shape

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.test.ts`

**Step 1: Write the failing mapping test**

Create `apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.test.ts` for the pure transformation helper that assembles approvals from pre-fetched maps.

```ts
import { describe, expect, it } from "vitest";
import { buildPendingApprovalResult } from "./queries";

describe("buildPendingApprovalResult", () => {
  it("returns absences and time corrections in request order", () => {
    const result = buildPendingApprovalResult({
      pendingRequests: [],
      absencesById: new Map(),
      periodsById: new Map(),
    });

    expect(result).toEqual({
      absenceApprovals: [],
      timeCorrectionApprovals: [],
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.test.ts"`
Expected: FAIL with missing helper export.

**Step 3: Implement batched query helpers**

In `apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.ts`:

- move `getPendingApprovals()` and `getPendingApprovalCounts()` out of `actions.ts`
- add helpers to split entity IDs by type
- fetch absences in one query
- fetch work periods in one query
- map each result set by entity ID
- build the final response in the original request order

Keep the returned object shape identical to the current UI contract.

**Step 4: Re-export query functions from `actions.ts`**

Make `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts` re-export both query functions and `getCurrentEmployee`.

**Step 5: Run the query test**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.test.ts"`
Expected: PASS.

**Step 6: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.test.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts" "apps/webapp/src/app/[locale]/(app)/approvals/actions.ts"
git commit -m "refactor: batch approvals read queries"
```

### Task 6: Update handler imports and verify the whole approvals flow

**Files:**
- Modify: `apps/webapp/src/lib/approvals/handlers/absence-request.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts`

**Step 1: Write the failing regression assertion**

Expand `apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts` so it verifies the route file still exports the same action names after caller imports are updated.

```ts
it("keeps backward-compatible aliases", () => {
  expect(actions.approveAbsence).toBe(actions.approveAbsenceEffect);
  expect(actions.rejectAbsence).toBe(actions.rejectAbsenceEffect);
  expect(actions.approveTimeCorrection).toBe(actions.approveTimeCorrectionEffect);
  expect(actions.rejectTimeCorrection).toBe(actions.rejectTimeCorrectionEffect);
});
```

**Step 2: Run the export regression test**

Run: `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts"`
Expected: FAIL if aliases drifted during the refactor.

**Step 3: Update handler imports**

In:

- `apps/webapp/src/lib/approvals/handlers/absence-request.handler.ts`
- `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`

replace dynamic imports of `@/app/[locale]/(app)/approvals/actions` with imports of the extracted server module functions, but leave the public route exports in place for UI callers.

**Step 4: Run targeted tests and then full verification**

Run, in order:

1. `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts"`
2. `pnpm test -- --run "apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.test.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.test.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.test.ts" "apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.test.ts"`
3. `pnpm test`
4. `pnpm build`

Expected: all targeted tests pass, the full test suite passes, and the webapp build succeeds.

**Step 5: Commit**

```bash
git add "apps/webapp/src/lib/approvals/handlers/absence-request.handler.ts" "apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts" "apps/webapp/src/app/[locale]/(app)/approvals/actions.exports.test.ts"
git commit -m "refactor: decouple approvals handlers from route actions"
```

### Task 7: Final review and cleanup

**Files:**
- Review: `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`
- Review: `apps/webapp/src/app/[locale]/(app)/approvals/_server/types.ts`
- Review: `apps/webapp/src/app/[locale]/(app)/approvals/_server/shared.ts`
- Review: `apps/webapp/src/app/[locale]/(app)/approvals/_server/absence-approvals.ts`
- Review: `apps/webapp/src/app/[locale]/(app)/approvals/_server/time-correction-approvals.ts`
- Review: `apps/webapp/src/app/[locale]/(app)/approvals/_server/queries.ts`

**Step 1: Remove leftover smells**

Delete unused imports, collapse obvious duplication, and remove any stray `any` types that remain without justification.

**Step 2: Check for layering regressions**

Verify the route file is a thin entrypoint, the shared workflow module owns orchestration, and the entity modules own only domain-specific behavior.

**Step 3: Run final verification one more time**

Run:

1. `pnpm test`
2. `pnpm build`

Expected: PASS.

**Step 4: Commit**

```bash
git add "apps/webapp/src/app/[locale]/(app)/approvals"
git commit -m "refactor: streamline approvals server actions"
```
