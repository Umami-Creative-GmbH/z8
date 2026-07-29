# Payroll Cutover Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve final payroll reconciliation counts in server logs without exposing them in the server-action response.

**Architecture:** Extend `CanonicalCutoverNotReadyError` with the final organization-scoped reconciliation result, then copy those aggregate diagnostics into the existing `ConflictError.details` property. The existing server-action logger prints the tagged error, while `toServerActionResult` continues returning only the generic message and error tag.

**Tech Stack:** TypeScript, Effect, Drizzle ORM, Vitest, pnpm.

---

## File Map

- Modify `apps/webapp/src/lib/time-record/migration/cutover-state.ts`: retain final reconciliation diagnostics on the typed readiness error.
- Modify `apps/webapp/src/lib/time-record/migration/cutover-state.test.ts`: prove persistent failures contain post-repair counts.
- Modify `apps/webapp/src/app/[locale]/(app)/payroll/action-errors.ts`: attach safe aggregate diagnostics to the mapped conflict.
- Modify `apps/webapp/src/app/[locale]/(app)/payroll/action-errors.test.ts`: prove conflict classification and diagnostic preservation.
- Create `apps/webapp/src/lib/effect/result.test.ts`: prove conflict details remain absent from browser-facing results.

### Task 1: Retain Final Reconciliation Diagnostics

**Files:**
- Modify: `apps/webapp/src/lib/time-record/migration/cutover-state.test.ts`
- Modify: `apps/webapp/src/lib/time-record/migration/cutover-state.ts`

- [ ] **Step 1: Add shared reconciliation fixtures to the readiness test**

Add these constants below the mock declarations in
`apps/webapp/src/lib/time-record/migration/cutover-state.test.ts`:

```ts
const initialMismatch = {
	workCountMismatch: 1,
	absenceCountMismatch: 0,
	durationMismatchRecords: 1,
	missingWorkCanonicalRecords: 1,
	missingAbsenceCanonicalRecords: 0,
	missingWorkDetailRows: 0,
	missingAbsenceDetailRows: 0,
	missingProjectAllocationRows: 0,
	approvalStateMismatchRecords: 0,
	missingAbsenceCanonicalLinks: 0,
	missingAbsenceOrganizationIds: 0,
};

const finalMismatch = {
	...initialMismatch,
	workCountMismatch: 0,
	durationMismatchRecords: 1,
	missingWorkCanonicalRecords: 0,
};
```

- [ ] **Step 2: Change the persistent-failure test to assert final diagnostics**

Replace the repeated reconciliation objects in `throws when repair backfill still leaves canonical mismatches` with the fixtures and strengthen the assertion:

```ts
reconcileLegacyToCanonical
	.mockResolvedValueOnce(initialMismatch)
	.mockResolvedValueOnce(finalMismatch);

await expect(assertCanonicalCutoverReady("org-1")).rejects.toMatchObject({
	name: "CanonicalCutoverNotReadyError",
	organizationId: "org-1",
	reconciliation: finalMismatch,
	message: "Canonical time-record backfill is incomplete for organization org-1",
});
```

This specifically proves the error reports the post-repair result rather than stale pre-repair counts.

- [ ] **Step 3: Run the readiness test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/time-record/migration/cutover-state.test.ts
```

Expected: FAIL because `CanonicalCutoverNotReadyError` has no `reconciliation` property and its constructor accepts only the organization ID.

- [ ] **Step 4: Extend the typed readiness error**

Update `apps/webapp/src/lib/time-record/migration/cutover-state.ts`:

```ts
import { eq } from "drizzle-orm";
import { db, employee } from "@/db";
import { runCanonicalBackfill } from "./backfill";
import {
	type LegacyCanonicalReconciliation,
	reconcileLegacyToCanonical,
} from "./reconciliation";

export class CanonicalCutoverNotReadyError extends Error {
	readonly organizationId: string;
	readonly reconciliation: LegacyCanonicalReconciliation;

	constructor(
		organizationId: string,
		reconciliation: LegacyCanonicalReconciliation,
	) {
		super(
			`Canonical time-record backfill is incomplete for organization ${organizationId}`,
		);
		this.name = "CanonicalCutoverNotReadyError";
		this.organizationId = organizationId;
		this.reconciliation = reconciliation;
	}
}
```

Change the persistent mismatch branch to pass the final result:

```ts
if (hasReconciliationMismatch(reconciliation)) {
	throw new CanonicalCutoverNotReadyError(organizationId, reconciliation);
}
```

- [ ] **Step 5: Update direct constructor usage in tests**

Search for direct construction:

```bash
rg 'new CanonicalCutoverNotReadyError' apps/webapp/src
```

For tests that only need a representative error, pass a zeroed
`LegacyCanonicalReconciliation` fixture. Do not make the constructor argument
optional because every real persistent readiness failure must carry evidence.

- [ ] **Step 6: Run the readiness test and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/time-record/migration/cutover-state.test.ts
```

Expected: all readiness tests pass.

### Task 2: Preserve Diagnostics Through Payroll Error Mapping

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/action-errors.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/action-errors.ts`

- [ ] **Step 1: Add a diagnostic fixture to the payroll mapper test**

Add below the translator in
`apps/webapp/src/app/[locale]/(app)/payroll/action-errors.test.ts`:

```ts
const reconciliation = {
	workCountMismatch: 0,
	absenceCountMismatch: 0,
	durationMismatchRecords: 2,
	missingWorkCanonicalRecords: 0,
	missingAbsenceCanonicalRecords: 0,
	missingWorkDetailRows: 0,
	missingAbsenceDetailRows: 0,
	missingProjectAllocationRows: 0,
	approvalStateMismatchRecords: 1,
	missingAbsenceCanonicalLinks: 0,
	missingAbsenceOrganizationIds: 0,
};
```

- [ ] **Step 2: Strengthen the cutover classification test**

Construct the typed error with diagnostics and assert the mapped details:

```ts
const result = mapPayrollWorkspaceActionError(
	new CanonicalCutoverNotReadyError("org-1", reconciliation),
	t,
);

expect(result).toMatchObject({
	_tag: "ConflictError",
	conflictType: "canonical_payroll_data_not_ready",
	message: "Payroll data is temporarily unavailable",
	details: {
		organizationId: "org-1",
		reconciliation,
	},
});
```

- [ ] **Step 3: Run the mapper test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/payroll/action-errors.test.ts'
```

Expected: FAIL because the mapped conflict does not contain `details`.

- [ ] **Step 4: Add safe aggregate details to the mapped conflict**

Update the `CanonicalCutoverNotReadyError` branch in
`apps/webapp/src/app/[locale]/(app)/payroll/action-errors.ts`:

```ts
if (error instanceof CanonicalCutoverNotReadyError) {
	return new ConflictError({
		message: t(
			"payroll.errors.dataTemporarilyUnavailable",
			"Payroll data is temporarily unavailable",
		),
		conflictType: "canonical_payroll_data_not_ready",
		details: {
			organizationId: error.organizationId,
			reconciliation: error.reconciliation,
		},
	});
}
```

- [ ] **Step 5: Run the mapper and readiness tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/payroll/action-errors.test.ts' \
  src/lib/time-record/migration/cutover-state.test.ts
```

Expected: both test files pass.

### Task 3: Prove Diagnostics Stay Server-Side

**Files:**
- Create: `apps/webapp/src/lib/effect/result.test.ts`

- [ ] **Step 1: Add a server-action serialization regression test**

Create `apps/webapp/src/lib/effect/result.test.ts`:

```ts
import { Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ConflictError } from "./errors";
import { toServerActionResult } from "./result";

describe("toServerActionResult", () => {
	it("logs conflict diagnostics without returning them to the client", () => {
		const error = new ConflictError({
			message: "Payroll data is temporarily unavailable",
			conflictType: "canonical_payroll_data_not_ready",
			details: {
				organizationId: "org-1",
				reconciliation: { durationMismatchRecords: 2 },
			},
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const result = toServerActionResult(Exit.fail(error));

		expect(consoleError).toHaveBeenCalledWith("[ServerAction Error]", error);
		expect(result).toEqual({
			success: false,
			error: "Payroll data is temporarily unavailable",
			code: "ConflictError",
		});
		expect(result).not.toHaveProperty("details");

		consoleError.mockRestore();
	});
});
```

- [ ] **Step 2: Run the serialization test**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/effect/result.test.ts
```

Expected: PASS against the existing serialization boundary.

- [ ] **Step 3: Run all focused diagnostics tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/effect/result.test.ts \
  src/lib/time-record/migration/cutover-state.test.ts \
  'src/app/[locale]/(app)/payroll/action-errors.test.ts'
```

Expected: all focused tests pass.

### Task 4: Verify Payroll Behavior and Prepare Deployment

**Files:**
- Verify only.

- [ ] **Step 1: Run related payroll and reconciliation tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/effect/result.test.ts \
  src/lib/time-record/migration/__tests__/reconciliation.test.ts \
  src/lib/time-record/migration/cutover-state.test.ts \
  src/lib/payroll-workspace/summary.cutover.test.ts \
  'src/app/[locale]/(app)/payroll/action-errors.test.ts' \
  'src/app/[locale]/(app)/payroll/actions.test.ts' \
  'src/app/[locale]/(app)/payroll/payroll-failure-state.test.tsx'
```

Expected: all selected test files pass.

- [ ] **Step 2: Run formatting and type checks**

Run:

```bash
pnpm --filter webapp exec ultracite check \
  src/lib/effect/result.test.ts \
  src/lib/time-record/migration/cutover-state.ts \
  src/lib/time-record/migration/cutover-state.test.ts \
  'src/app/[locale]/(app)/payroll/action-errors.ts' \
  'src/app/[locale]/(app)/payroll/action-errors.test.ts'
pnpm --filter webapp typecheck
```

Expected: both commands complete successfully.

- [ ] **Step 3: Review the final diff**

Run:

```bash
git diff --check
git diff -- \
  apps/webapp/src/lib/effect/result.test.ts \
  apps/webapp/src/lib/time-record/migration/cutover-state.ts \
  apps/webapp/src/lib/time-record/migration/cutover-state.test.ts \
  'apps/webapp/src/app/[locale]/(app)/payroll/action-errors.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/action-errors.test.ts'
```

Confirm that only aggregate counts and the organization ID are logged, the
browser response shape is unchanged, and organization-scoped reconciliation is
untouched.

- [ ] **Step 4: Deploy and trigger one payroll request**

Deploy an image containing the patch, open the payroll page once, and inspect
the `[ServerAction Error]` entry. It should include:

```txt
conflictType: canonical_payroll_data_not_ready
details.organizationId: org-id
details.reconciliation: aggregate metric counts
```

Use the nonzero post-repair metric to design the subsequent data repair. Do not
disable the readiness gate.
