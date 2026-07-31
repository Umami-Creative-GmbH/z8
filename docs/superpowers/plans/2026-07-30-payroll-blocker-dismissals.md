# Permanent Payroll Blocker Dismissals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let payroll officers permanently clear individual false-positive blockers through an immutable, organization-scoped, one-click dismissal.

**Architecture:** Persist typed blocker dismissals independently from source time and approval records. Validate each dismissal by rebuilding the current organization- and employee-scoped payroll summary, then filter exact typed source matches from future summaries and refresh the client from server state.

**Tech Stack:** TypeScript, Next.js Server Actions, React, Drizzle ORM, PostgreSQL, Effect, Vitest, Testing Library, Tolgee, pnpm.

---

## File Map

- Create `apps/webapp/src/db/schema/payroll-blocker.ts`: immutable dismissal table.
- Modify `apps/webapp/src/db/schema/index.ts`: export dismissal schema.
- Create `apps/webapp/drizzle/0056_payroll_blocker_dismissal.sql`: table, constraints, indexes.
- Modify `apps/webapp/drizzle/meta/_journal.json`: register migration 0056 after 0055.
- Create `apps/webapp/src/db/schema/__tests__/payroll-blocker-schema.test.ts`: schema and migration guardrails.
- Create `apps/webapp/src/lib/payroll-workspace/blocker-dismissals.ts`: pure exact-match filtering and dismissal-key helpers.
- Create `apps/webapp/src/lib/payroll-workspace/blocker-dismissals.test.ts`: permanent typed filtering tests.
- Modify `apps/webapp/src/lib/payroll-workspace/summary.ts`: remove permanently dismissed candidates.
- Modify `apps/webapp/src/lib/payroll-workspace/summary.test.ts`: preserve counts/status after filtering.
- Modify `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`: secure idempotent dismissal action.
- Modify `apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts`: authorization, scope, stale-source, and idempotency tests.
- Modify `apps/webapp/src/components/payroll/payroll-workspace.tsx`: one-click clear button and server refresh.
- Modify `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`: pending, success, and failure behavior.
- Modify `apps/webapp/messages/payroll/*.json`: clear/pending/error strings in every payroll locale.

### Task 1: Add Immutable Organization-Scoped Dismissal Storage

**Files:**
- Create: `apps/webapp/src/db/schema/payroll-blocker.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Create: `apps/webapp/drizzle/0056_payroll_blocker_dismissal.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Create: `apps/webapp/src/db/schema/__tests__/payroll-blocker-schema.test.ts`

- [ ] **Step 1: Write failing schema and migration tests**

Create `payroll-blocker-schema.test.ts` that reads the migration and imports the
schema:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { payrollBlockerDismissal } from "@/db/schema/payroll-blocker";

describe("payroll blocker dismissal schema", () => {
	it("exports immutable dismissal columns", () => {
		expect(Object.keys(payrollBlockerDismissal)).toEqual(
		expect.arrayContaining([
			"id",
			"organizationId",
			"blockerType",
			"sourceId",
			"employeeId",
			"dismissedByEmployeeId",
			"dismissedAt",
		]),
	);
	});

	it("creates scoped uniqueness and employee foreign keys", () => {
		const sql = readFileSync(
			resolve(process.cwd(), "drizzle/0056_payroll_blocker_dismissal.sql"),
			"utf8",
		);

		expect(sql).toContain('CREATE TABLE "payroll_blocker_dismissal"');
		expect(sql).toContain('UNIQUE("organization_id","blocker_type","source_id")');
		expect(sql).toContain('FOREIGN KEY ("employee_id","organization_id")');
		expect(sql).toContain('FOREIGN KEY ("dismissed_by_employee_id","organization_id")');
		expect(sql).toContain("missing_clock_out");
		expect(sql).toContain("pending_absence");
		expect(sql).toContain("pending_time_correction");
	});
});
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/db/schema/__tests__/payroll-blocker-schema.test.ts
```

Expected: failure because the schema and migration do not exist.

- [ ] **Step 3: Create the Drizzle schema**

Create `payroll-blocker.ts`:

```ts
import { check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "../auth-schema";
import { employee } from "./organization";

export const payrollBlockerDismissal = pgTable(
	"payroll_blocker_dismissal",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		blockerType: text("blocker_type")
			.$type<"missing_clock_out" | "pending_absence" | "pending_time_correction">()
			.notNull(),
		sourceId: uuid("source_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		dismissedByEmployeeId: uuid("dismissed_by_employee_id").notNull(),
		dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
	},
	(table) => [
		unique("payrollBlockerDismissal_org_type_source_idx").on(
			table.organizationId,
			table.blockerType,
			table.sourceId,
		),
		index("payrollBlockerDismissal_org_employee_idx").on(
			table.organizationId,
			table.employeeId,
		),
		index("payrollBlockerDismissal_actor_idx").on(table.dismissedByEmployeeId),
		foreignKey({
			name: "payrollBlockerDismissal_employee_org_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "payrollBlockerDismissal_actor_org_fk",
			columns: [table.dismissedByEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"payrollBlockerDismissal_type_chk",
			sql`${table.blockerType} in ('missing_clock_out', 'pending_absence', 'pending_time_correction')`,
		),
	],
);
```

Export it from `schema/index.ts`.

- [ ] **Step 4: Add migration 0056 and journal entry**

Create SQL matching the schema, including all named constraints and indexes.
Append to `_journal.json`:

```json
{
  "idx": 56,
  "version": "7",
  "when": 1785355600000,
  "tag": "0056_payroll_blocker_dismissal",
  "breakpoints": true
}
```

Do not renumber or reformat earlier journal entries.

- [ ] **Step 5: Run schema tests and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/db/schema/__tests__/payroll-blocker-schema.test.ts
```

Expected: all schema tests pass.

### Task 2: Filter Exact Permanent Dismissals

**Files:**
- Create: `apps/webapp/src/lib/payroll-workspace/blocker-dismissals.ts`
- Create: `apps/webapp/src/lib/payroll-workspace/blocker-dismissals.test.ts`
- Modify: `apps/webapp/src/lib/payroll-workspace/summary.ts`
- Modify: `apps/webapp/src/lib/payroll-workspace/summary.test.ts`

- [ ] **Step 1: Write failing exact-match tests**

Create `blocker-dismissals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterDismissedPayrollBlockers } from "./blocker-dismissals";

const blocker = {
	id: "11111111-1111-4111-8111-111111111111",
	employeeId: "employee-1",
	type: "missing_clock_out" as const,
	label: "Missing clock-out",
	date: "2026-06-10",
	time: "09:00",
};

describe("filterDismissedPayrollBlockers", () => {
	it("removes only an exact type and source match", () => {
		expect(
			filterDismissedPayrollBlockers(
				[blocker, { ...blocker, type: "pending_absence", label: "Pending absence" }],
				[{ blockerType: "missing_clock_out", sourceId: blocker.id }],
			),
		).toEqual([{ ...blocker, type: "pending_absence", label: "Pending absence" }]);
	});

	it("keeps all candidates without dismissals", () => {
		expect(filterDismissedPayrollBlockers([blocker], [])).toEqual([blocker]);
	});
});
```

- [ ] **Step 2: Run filtering tests and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/payroll-workspace/blocker-dismissals.test.ts
```

Expected: failure because the module does not exist.

- [ ] **Step 3: Implement pure exact-match filtering**

Create:

```ts
import type { PayrollBlocker, PayrollBlockerType } from "./types";

export interface PayrollBlockerDismissalKey {
	blockerType: PayrollBlockerType;
	sourceId: string;
}

function dismissalKey(type: PayrollBlockerType, sourceId: string) {
	return `${type}:${sourceId}`;
}

export function filterDismissedPayrollBlockers(
	blockers: PayrollBlocker[],
	dismissals: PayrollBlockerDismissalKey[],
): PayrollBlocker[] {
	const dismissedKeys = new Set(
		dismissals.map((row) => dismissalKey(row.blockerType, row.sourceId)),
	);
	return blockers.filter((blocker) => !dismissedKeys.has(dismissalKey(blocker.type, blocker.id)));
}
```

- [ ] **Step 4: Filter candidates in the organization-scoped blocker loader**

After constructing all blocker candidates in `getBlockers`, return early if
empty. Otherwise query:

```ts
const dismissals = await db.query.payrollBlockerDismissal.findMany({
	where: and(
		eq(payrollBlockerDismissal.organizationId, organizationId),
		inArray(payrollBlockerDismissal.sourceId, candidates.map((item) => item.id)),
	),
	columns: { blockerType: true, sourceId: true },
});

return filterDismissedPayrollBlockers(candidates, dismissals);
```

Keep candidate generation and source queries unchanged.

- [ ] **Step 5: Add summary-count regression coverage**

Extend `summary.test.ts` to feed one remaining blocker after filtering and prove
`blockerCount` and `hasBlockers` derive only from that filtered list. Reuse the
existing `buildPayrollSummaryFromRows` test fixtures with required date/time.

- [ ] **Step 6: Run blocker and summary tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/payroll-workspace/blocker-dismissals.test.ts \
  src/lib/payroll-workspace/summary.test.ts
```

Expected: all selected tests pass.

### Task 3: Add Secure Idempotent Dismissal Action

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/actions.test.ts`

- [ ] **Step 1: Add failing action tests**

Extend action mocks for `payrollBlockerDismissal` reads/inserts. Add tests for:

```txt
1. In-scope live blocker inserts server-resolved organization, employee, actor, type, and source.
2. Existing exact dismissal returns success without a second row.
3. Unknown source is rejected.
4. Source outside requested/allowed payroll employee scope is rejected.
5. Cross-organization existing dismissal or source cannot authorize a write.
6. Client request contains no organizationId, employeeId, or actor field.
```

Use a valid UUID source ID because the dismissal column is UUID-backed.

- [ ] **Step 2: Run focused action tests and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/payroll/actions.test.ts'
```

Expected: failures because the dismissal action does not exist.

- [ ] **Step 3: Add request type and validation**

Add:

```ts
export interface DismissPayrollBlockerRequest extends PayrollWorkspaceRequest {
	blockerId: string;
	blockerType: PayrollBlockerType;
}
```

Validate blocker ID with the existing UUID validation convention and blocker
type against all three supported values. Invalid values return
`ValidationError` before database writes.

- [ ] **Step 4: Implement the action with server-resolved identity**

Add `dismissPayrollBlockerAction` through `runPayrollWorkspaceAction`:

```ts
export async function dismissPayrollBlockerAction(
	request: DismissPayrollBlockerRequest,
): Promise<ServerActionResult<{ dismissed: true }>> {
	return runPayrollWorkspaceAction(async (t) => {
		const blockerId = validateBlockerId(t, request.blockerId);
		const blockerType = validateBlockerType(t, request.blockerType);
		const { authContext, period, scopedEmployeeIds } =
			await resolvePayrollWorkspaceActionContext(t, request);
		const organizationId = authContext.employee.organizationId;

		const existing = await db.query.payrollBlockerDismissal.findFirst({
			where: and(
				eq(payrollBlockerDismissal.organizationId, organizationId),
				eq(payrollBlockerDismissal.blockerType, blockerType),
				eq(payrollBlockerDismissal.sourceId, blockerId),
			),
			columns: { employeeId: true },
		});
		if (existing) {
			if (!scopedEmployeeIds.includes(existing.employeeId)) {
				throw new AuthorizationError({
					message: t("payroll.errors.blockerOutsideScope", "Payroll blocker is outside your scope"),
					resource: "payroll_blocker",
					action: "dismiss",
				});
			}
			return { dismissed: true };
		}

		const summary = await getPayrollWorkspaceSummary({
			organizationId,
			allowedEmployeeIds: scopedEmployeeIds,
			period,
			generatedBy: {
				id: authContext.employee.id,
				name: authContext.user.name || authContext.user.email,
			},
		});
		const blocker = summary.blockers.find(
			(item) => item.id === blockerId && item.type === blockerType,
		);
		if (!blocker) {
			throw new ValidationError({
				message: t("payroll.errors.blockerNotFound", "Payroll blocker was not found"),
				field: "blockerId",
			});
		}

		await db
			.insert(payrollBlockerDismissal)
			.values({
				organizationId,
				blockerType,
				sourceId: blocker.id,
				employeeId: blocker.employeeId,
				dismissedByEmployeeId: authContext.employee.id,
			})
			.onConflictDoNothing();

		return { dismissed: true };
	});
}
```

Do not accept or spread client identity fields.

- [ ] **Step 5: Run action and security tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/payroll/actions.test.ts' \
  src/lib/payroll-access/permissions.test.ts
```

Expected: all selected tests pass.

### Task 4: Add One-Click Clear and Server Refresh

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`
- Modify: `apps/webapp/messages/payroll/*.json`

- [ ] **Step 1: Add failing interaction tests**

Mock `dismissPayrollBlockerAction`. Add tests proving:

```txt
- Every blocker row has a contextual "Clear false positive" button.
- Clicking one row submits its blocker ID/type and current date range/filter request.
- Only the clicked button is disabled and displays clearing state.
- Success calls getPayrollWorkspaceSummaryAction with the same request and renders refreshed counts/rows.
- Dismissal failure keeps the row and shows an error toast.
- Refresh failure keeps current state and shows an error toast.
```

Use row-scoped `within` queries and deferred promises to assert pending state.

- [ ] **Step 2: Run workspace tests and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/payroll/payroll-workspace.test.tsx
```

Expected: failures because clear controls and action wiring do not exist.

- [ ] **Step 3: Add localized labels to every payroll catalog**

Add matching keys under `payroll.blockers` in all ten locale files:

```json
"clearFalsePositive": "Clear false positive",
"clearingFalsePositive": "Clearing false positive",
"clearFailed": "Could not clear payroll blocker",
"refreshAfterClearFailed": "Blocker cleared, but payroll could not be refreshed"
```

Use natural translations in non-English catalogs and keep key parity.

- [ ] **Step 4: Implement row-specific pending state**

Import `dismissPayrollBlockerAction`. Add `clearingBlockerId` state in
`PayrollWorkspace` and an async handler that:

```ts
setClearingBlockerId(blocker.id);
const dismissal = await dismissPayrollBlockerAction({
	...request,
	blockerId: blocker.id,
	blockerType: blocker.type,
});
if (!dismissal.success) {
	toast.error(dismissal.error || t("payroll.blockers.clearFailed", "Could not clear payroll blocker"));
	setClearingBlockerId(null);
	return;
}

const refreshed = await getPayrollWorkspaceSummaryAction(request);
if (!refreshed.success) {
	toast.error(
		t("payroll.blockers.refreshAfterClearFailed", "Blocker cleared, but payroll could not be refreshed"),
	);
	setClearingBlockerId(null);
	return;
}

dispatch({ type: "summaryRefreshed", summary: refreshed.data });
setClearingBlockerId(null);
```

Use `try/finally` so unexpected rejection also clears the pending state.

- [ ] **Step 5: Render the clear button in each blocker row**

Pass `clearingBlockerId` and `onClearBlocker` into `PayrollBlockersAlert`.
Render a small button beside the existing workflow link. Disable only when its
row ID matches. Its accessible label must include employee and blocker type so
repeated buttons remain distinguishable.

Do not add a confirmation dialog or optimistic removal.

- [ ] **Step 6: Run workspace tests and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/payroll/payroll-workspace.test.tsx
```

Expected: all workspace tests pass.

### Task 5: Verify Security, Migration, Payroll, and React Behavior

**Files:**
- Verify only.

- [ ] **Step 1: Load and apply security review guidance**

Use the `security-review` skill. Confirm server-resolved organization, employee,
and actor identity; exact source validation; idempotency; CSRF protections from
Server Actions; no client-controlled scope; and no source mutation.

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/db/schema/__tests__/payroll-blocker-schema.test.ts \
  src/lib/payroll-workspace/blocker-dismissals.test.ts \
  src/lib/payroll-workspace/summary.test.ts \
  src/lib/payroll-workspace/summary.cutover.test.ts \
  'src/app/[locale]/(app)/payroll/actions.test.ts' \
  src/components/payroll/payroll-workspace.test.tsx
```

- [ ] **Step 3: Run migration, formatting, and type checks**

Run targeted Ultracite checks without broad baseline formatting churn, then:

```bash
pnpm --filter webapp typecheck
git diff --check
```

Validate `_journal.json`, all ten payroll JSON catalogs, and migration SQL.

- [ ] **Step 4: Run React Doctor**

From `apps/webapp` run:

```bash
npx react-doctor@latest --verbose --scope changed
```

No finding may point to the dismissal UI changes.

- [ ] **Step 5: Review final invariants**

Confirm:

```txt
Dismissals are permanent and immutable.
Unique identity is organization + blocker type + source ID.
Every action re-authenticates and verifies live scoped blocker existence.
Duplicate actions are idempotent.
Dismissed blockers do not affect list/count/employee status/PDF.
Source time and approval records are never mutated.
Only the selected row enters pending state.
The client refreshes from server truth after success.
No undo or bulk-clear path exists.
```
