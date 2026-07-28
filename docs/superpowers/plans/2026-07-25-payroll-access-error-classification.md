# Payroll Access Error Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop reporting assigned payroll officers as unauthorized when canonical payroll data is temporarily unavailable.

**Architecture:** Give the canonical cutover failure a stable runtime type, translate it at the payroll server-action boundary into a safe `ConflictError`, and render payroll access denial only for authentication and authorization result codes. Keep the canonical integrity guard and all organization-scoped grant resolution unchanged.

**Tech Stack:** TypeScript, Next.js server components and server actions, Effect tagged errors, Vitest, React Testing Library, pnpm.

## Global Constraints

- Authorization remains fail-closed and organization-scoped.
- The change must not broaden payroll access or bypass employee scope.
- Incomplete canonical payroll totals remain blocked.
- Client-facing messages remain generic; detailed causes stay in server logs.
- Use pnpm only.
- Keep canonical payroll date/time behavior unchanged.

---

## File Structure

- `apps/webapp/src/lib/time-record/migration/cutover-state.ts`: owns the stable error type emitted when reconciliation/backfill cannot make canonical data ready.
- `apps/webapp/src/lib/time-record/migration/cutover-state.test.ts`: proves the cutover guard emits the stable error only after repair still fails.
- `apps/webapp/src/app/[locale]/(app)/payroll/action-errors.ts`: maps payroll action failures to existing safe Effect application errors.
- `apps/webapp/src/app/[locale]/(app)/payroll/action-errors.test.ts`: proves classification preserves auth/validation errors, identifies data-readiness conflicts, and retains unexpected causes in server-only database errors.
- `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`: delegates action error classification to the mapper.
- `apps/webapp/src/app/[locale]/(app)/payroll/payroll-failure-state.tsx`: renders either access denial or temporary unavailability from a server-action error code.
- `apps/webapp/src/app/[locale]/(app)/payroll/payroll-failure-state.test.tsx`: verifies the user-visible distinction using the real component.
- `apps/webapp/src/app/[locale]/(app)/payroll/page.tsx`: uses the failure-state component for unsuccessful initial summary loads.

### Task 1: Give canonical cutover failures a stable type

**Files:**
- Modify: `apps/webapp/src/lib/time-record/migration/cutover-state.ts`
- Modify: `apps/webapp/src/lib/time-record/migration/cutover-state.test.ts`

**Interfaces:**
- Produces: `CanonicalCutoverNotReadyError extends Error` with `organizationId: string`.
- Consumed by: Task 2's `mapPayrollWorkspaceActionError`.

- [ ] **Step 1: Write the failing typed-error assertion**

Update the existing “throws when repair backfill still leaves canonical mismatches” test so it captures the rejection and checks its observable type and organization:

```ts
await expect(assertCanonicalCutoverReady("org-1")).rejects.toMatchObject({
	name: "CanonicalCutoverNotReadyError",
	organizationId: "org-1",
	message: "Canonical time-record backfill is incomplete for organization org-1",
});
```

This catches a regression where the cutover guard falls back to an unclassifiable plain `Error`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/time-record/migration/cutover-state.test.ts
```

Expected: FAIL because the rejection currently has `name: "Error"` and no `organizationId`.

- [ ] **Step 3: Implement the stable cutover error**

Add this export near the imports in `cutover-state.ts`:

```ts
export class CanonicalCutoverNotReadyError extends Error {
	readonly organizationId: string;

	constructor(organizationId: string) {
		super(`Canonical time-record backfill is incomplete for organization ${organizationId}`);
		this.name = "CanonicalCutoverNotReadyError";
		this.organizationId = organizationId;
	}
}
```

Replace the final plain error:

```ts
if (hasReconciliationMismatch(reconciliation)) {
	throw new CanonicalCutoverNotReadyError(organizationId);
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/time-record/migration/cutover-state.test.ts
```

Expected: PASS with all cutover-state tests green.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/webapp/src/lib/time-record/migration/cutover-state.ts apps/webapp/src/lib/time-record/migration/cutover-state.test.ts
git commit -m "fix(payroll): type canonical readiness failures"
```

### Task 2: Preserve payroll action error meaning

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/payroll/action-errors.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/payroll/action-errors.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`

**Interfaces:**
- Consumes: `CanonicalCutoverNotReadyError` from Task 1.
- Produces:

```ts
export type PayrollErrorTranslator = (key: string, fallback: string) => string;

export function mapPayrollWorkspaceActionError(
	error: unknown,
	t: PayrollErrorTranslator,
): AnyAppError;
```

- [ ] **Step 1: Write the failing error-mapper tests**

Create `action-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	AuthenticationError,
	AuthorizationError,
	DatabaseError,
	ValidationError,
} from "@/lib/effect/errors";
import { CanonicalCutoverNotReadyError } from "@/lib/time-record/migration/cutover-state";
import { mapPayrollWorkspaceActionError } from "./action-errors";

const t = (_key: string, fallback: string) => fallback;

describe("mapPayrollWorkspaceActionError", () => {
	it("classifies incomplete canonical payroll data as a conflict", () => {
		const result = mapPayrollWorkspaceActionError(
			new CanonicalCutoverNotReadyError("org-1"),
			t,
		);

		expect(result).toMatchObject({
			_tag: "ConflictError",
			conflictType: "canonical_payroll_data_not_ready",
			message: "Payroll data is temporarily unavailable",
		});
		expect(result._tag).not.toBe("ValidationError");
	});

	it("preserves authentication, authorization, and validation failures", () => {
		const authentication = new AuthenticationError({ message: "Sign in" });
		const authorization = new AuthorizationError({ message: "Denied" });
		const validation = new ValidationError({ message: "Bad request" });

		expect(mapPayrollWorkspaceActionError(authentication, t)).toBe(authentication);
		expect(mapPayrollWorkspaceActionError(authorization, t)).toBe(authorization);
		expect(mapPayrollWorkspaceActionError(validation, t)).toBe(validation);
	});

	it("keeps unexpected causes in a server-side database error", () => {
		const cause = new Error("query failed");
		const result = mapPayrollWorkspaceActionError(cause, t);

		expect(result).toBeInstanceOf(DatabaseError);
		expect(result).toMatchObject({
			_tag: "DatabaseError",
			message: "Payroll workspace action failed",
			operation: "payroll_workspace_action",
			cause,
		});
	});
});
```

The production change that makes these pass is replacing the current catch-all `ValidationError` mapping with semantic classification.

- [ ] **Step 2: Run the mapper tests and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/payroll/action-errors.test.ts'
```

Expected: FAIL because `action-errors.ts` and `mapPayrollWorkspaceActionError` do not exist.

- [ ] **Step 3: Implement the error mapper**

Create `action-errors.ts`:

```ts
import {
	type AnyAppError,
	AuthenticationError,
	AuthorizationError,
	ConflictError,
	DatabaseError,
	ValidationError,
} from "@/lib/effect/errors";
import { CanonicalCutoverNotReadyError } from "@/lib/time-record/migration/cutover-state";

export type PayrollErrorTranslator = (key: string, fallback: string) => string;

export function mapPayrollWorkspaceActionError(
	error: unknown,
	t: PayrollErrorTranslator,
): AnyAppError {
	if (isKnownPayrollActionError(error)) {
		return error;
	}

	if (error instanceof CanonicalCutoverNotReadyError) {
		return new ConflictError({
			message: t(
				"payroll.errors.dataTemporarilyUnavailable",
				"Payroll data is temporarily unavailable",
			),
			conflictType: "canonical_payroll_data_not_ready",
		});
	}

	return new DatabaseError({
		message: t("payroll.errors.actionFailed", "Payroll workspace action failed"),
		operation: "payroll_workspace_action",
		cause: error,
	});
}

function isKnownPayrollActionError(error: unknown): error is AnyAppError {
	return (
		error instanceof AuthenticationError ||
		error instanceof AuthorizationError ||
		error instanceof ConflictError ||
		error instanceof DatabaseError ||
		error instanceof ValidationError
	);
}
```

- [ ] **Step 4: Integrate the mapper into the action wrapper**

In `actions.ts`, import `mapPayrollWorkspaceActionError`, remove the local `isAppError` function, remove now-unused error imports, and replace the catch body with:

```ts
catch: (error) => mapPayrollWorkspaceActionError(error, t),
```

This keeps input `ValidationError`s intact while ensuring cutover and unexpected operational failures are no longer logged or returned as validation failures.

- [ ] **Step 5: Run focused action tests and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/payroll/action-errors.test.ts' \
  'src/app/[locale]/(app)/payroll/actions.test.ts' \
  'src/app/[locale]/(app)/payroll/actions.start-export.test.ts'
```

Expected: PASS. The data-readiness mapper result has `_tag: "ConflictError"` and unexpected errors retain their cause only on `DatabaseError`.

- [ ] **Step 6: Commit Task 2**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/payroll/action-errors.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/action-errors.test.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/actions.ts'
git commit -m "fix(payroll): preserve workspace error classification"
```

### Task 3: Distinguish denied access from temporary unavailability

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/payroll/payroll-failure-state.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/payroll/payroll-failure-state.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/page.tsx`

**Interfaces:**
- Produces:

```ts
export type PayrollFailureTranslator = (key: string, fallback: string) => string;

export function PayrollFailureState(props: {
	code?: string;
	t: PayrollFailureTranslator;
}): React.JSX.Element;
```

- Consumed by: `PayrollPage` when `summaryResult.success === false`.

- [ ] **Step 1: Write the failing real-component tests**

Create `payroll-failure-state.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayrollFailureState } from "./payroll-failure-state";

const t = (_key: string, fallback: string) => fallback;

describe("PayrollFailureState", () => {
	it.each(["AuthenticationError", "AuthorizationError"])(
		"renders access denied for %s",
		(code) => {
			render(<PayrollFailureState code={code} t={t} />);

			expect(screen.getByText("No payroll access")).toBeTruthy();
			expect(screen.queryByText("Payroll temporarily unavailable")).toBeNull();
		},
	);

	it.each(["ConflictError", "DatabaseError", "UNKNOWN_ERROR", undefined])(
		"renders temporary unavailability for operational code %s",
		(code) => {
			render(<PayrollFailureState code={code} t={t} />);

			expect(screen.getByText("Payroll temporarily unavailable")).toBeTruthy();
			expect(screen.queryByText("No payroll access")).toBeNull();
		},
	);
});
```

The tests exercise the real failure-state component, not a mocked UI or source-text assertion.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/payroll/payroll-failure-state.test.tsx'
```

Expected: FAIL because `PayrollFailureState` does not exist.

- [ ] **Step 3: Implement the failure-state component**

Create `payroll-failure-state.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type PayrollFailureTranslator = (key: string, fallback: string) => string;

export function PayrollFailureState({
	code,
	t,
}: {
	code?: string;
	t: PayrollFailureTranslator;
}) {
	const accessDenied = code === "AuthenticationError" || code === "AuthorizationError";
	const title = accessDenied
		? t("payroll.accessDenied.title", "No payroll access")
		: t("payroll.unavailable.title", "Payroll temporarily unavailable");
	const description = accessDenied
		? t(
				"payroll.accessDenied.description",
				"You do not have access to payroll data for the active organization.",
			)
		: t(
				"payroll.unavailable.description",
				"Payroll data could not be prepared safely.",
			);
	const help = accessDenied
		? t(
				"payroll.accessDenied.help",
				"Ask an organization administrator to assign payroll access if you need this workspace.",
			)
		: t(
				"payroll.unavailable.help",
				"Please try again later. If the problem continues, contact an organization administrator.",
			);

	return (
		<div className="@container/main flex flex-1 items-center justify-center p-6">
			<Card className="max-w-md text-center">
				<CardHeader>
					<CardTitle>{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent className="text-muted-foreground text-sm">{help}</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 4: Use the component from the payroll page**

In `page.tsx`, remove the direct error `Card` markup and its now-unused UI imports. Add:

```ts
import { PayrollFailureState } from "./payroll-failure-state";
```

Replace the unsuccessful summary branch with:

```tsx
if (!summaryResult.success) {
	return <PayrollFailureState code={summaryResult.code} t={t} />;
}
```

- [ ] **Step 5: Run the focused UI test and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/payroll/payroll-failure-state.test.tsx'
```

Expected: PASS for auth, conflict, database, unknown, and missing error codes.

- [ ] **Step 6: Commit Task 3**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/payroll/payroll-failure-state.tsx' \
  'apps/webapp/src/app/[locale]/(app)/payroll/payroll-failure-state.test.tsx' \
  'apps/webapp/src/app/[locale]/(app)/payroll/page.tsx'
git commit -m "fix(payroll): distinguish unavailable data from denied access"
```

### Task 4: Regression and security verification

**Files:**
- Verify only; modify earlier task files only if a check exposes a defect.

**Interfaces:**
- Consumes all Task 1–3 behavior.
- Produces a verified payroll access fix with no widened authorization scope.

- [ ] **Step 1: Run the complete focused regression set**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/time-record/migration/cutover-state.test.ts' \
  'src/lib/payroll-workspace/summary.cutover.test.ts' \
  'src/lib/payroll-access/permissions.test.ts' \
  'src/app/[locale]/(app)/payroll/action-errors.test.ts' \
  'src/app/[locale]/(app)/payroll/actions.test.ts' \
  'src/app/[locale]/(app)/payroll/actions.start-export.test.ts' \
  'src/app/[locale]/(app)/payroll/payroll-failure-state.test.tsx' \
  'src/components/app-sidebar.test.tsx'
```

Expected: PASS with no unexpected warnings.

- [ ] **Step 2: Run webapp type checking**

Run:

```bash
pnpm --filter webapp typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run formatting and static checks on touched files**

Run:

```bash
pnpm exec ultracite check \
  'apps/webapp/src/lib/time-record/migration/cutover-state.ts' \
  'apps/webapp/src/lib/time-record/migration/cutover-state.test.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/action-errors.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/action-errors.test.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/actions.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/payroll-failure-state.tsx' \
  'apps/webapp/src/app/[locale]/(app)/payroll/payroll-failure-state.test.tsx' \
  'apps/webapp/src/app/[locale]/(app)/payroll/page.tsx'
```

Expected: PASS with no formatting, lint, accessibility, or import-order findings.

- [ ] **Step 4: Review the authorization and data-integrity diff**

Run:

```bash
git diff HEAD~3 -- \
  'apps/webapp/src/lib/time-record/migration/cutover-state.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/action-errors.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/actions.ts' \
  'apps/webapp/src/app/[locale]/(app)/payroll/payroll-failure-state.tsx' \
  'apps/webapp/src/app/[locale]/(app)/payroll/page.tsx'
```

Confirm all four invariants:

```txt
1. Payroll grant lookup and employee scope resolution are unchanged.
2. Organization IDs remain server-derived and organization-scoped.
3. Canonical cutover mismatch still blocks totals and exports.
4. Client responses contain safe copy while server-side DatabaseError retains unexpected causes.
```

- [ ] **Step 5: Check the final working tree**

Run:

```bash
git status --short --branch
```

Expected: the implementation commits are present and there are no unintended or uncommitted files.
