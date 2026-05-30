# Employee Start Date Work Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff set `employee.startDate` in the employee detail UI and make all-time work-balance calculations start no earlier than that date.

**Architecture:** Reuse the existing `employee.startDate` column and validation schema. Wire the field into the TanStack employee edit form as a date-only string, convert it to `Date | null` on submit, then clamp balance period aggregation to the employee start date in the worker path.

**Tech Stack:** Next.js 16, React 19, TanStack Form, Drizzle ORM, Luxon, Vitest, pnpm.

---

## File Map

- Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts`: add date formatting/parsing helpers, include `startDate` in employee form state, and build the server update payload.
- Create `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts`: test form date defaults and submit conversion helpers.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`: use the page utility to convert form values before calling `updateEmployee`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx`: render the `Start date` date input in the edit card.
- Modify `apps/webapp/src/lib/work-balance/period-aggregation.ts`: allow a period calculation to use a later effective source start date than the stored period bucket start.
- Modify `apps/webapp/src/lib/work-balance/period-aggregation.test.ts`: verify period aggregation clips actual and required queries to `calculationStartDate`.
- Modify `apps/webapp/src/lib/work-balance/service.ts`: read `employee.startDate`, clamp affected periods, pass the start date into period aggregation, and keep organization scoping.
- Modify `apps/webapp/src/lib/work-balance/service.test.ts`: update and add worker tests for start-date boundaries.

---

### Task 1: Add Employee Detail Form Start Date Helpers

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts`

- [ ] **Step 1: Write failing tests for date-only form state**

Create `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	buildEmployeeUpdatePayload,
	defaultFormValues,
	formatEmployeeDetailDateInputValue,
	parseEmployeeDetailDateInputValue,
} from "./page-utils";

describe("employee detail page utilities", () => {
	it("includes an empty start date in default form values", () => {
		expect(defaultFormValues.startDate).toBe("");
	});

	it("formats employee dates for date inputs in UTC date-only form", () => {
		expect(
			formatEmployeeDetailDateInputValue(new Date("2026-05-01T22:30:00.000Z")),
		).toBe("2026-05-01");
		expect(formatEmployeeDetailDateInputValue(null)).toBe("");
		expect(formatEmployeeDetailDateInputValue(undefined)).toBe("");
	});

	it("parses date input values for employee updates", () => {
		expect(parseEmployeeDetailDateInputValue("")).toBeNull();
		expect(parseEmployeeDetailDateInputValue("2026-05-01")).toEqual(
			new Date("2026-05-01T00:00:00.000Z"),
		);
	});

	it("builds employee update payloads with nullable start dates", () => {
		expect(
			buildEmployeeUpdatePayload({
				...defaultFormValues,
				position: "Engineer",
				startDate: "2026-05-01",
			}),
		).toEqual(
			expect.objectContaining({
				position: "Engineer",
				startDate: new Date("2026-05-01T00:00:00.000Z"),
			}),
		);

		expect(buildEmployeeUpdatePayload(defaultFormValues)).toEqual(
			expect.objectContaining({ startDate: null }),
		);
	});
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm --filter webapp test -- src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.test.ts
```

Expected: FAIL because `buildEmployeeUpdatePayload`, `formatEmployeeDetailDateInputValue`, `parseEmployeeDetailDateInputValue`, and `defaultFormValues.startDate` do not exist yet.

- [ ] **Step 3: Implement date helpers and form state**

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts`:

```ts
import { DateTime } from "luxon";
import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import type { EmployeeDetail } from "@/lib/query/use-employee";

export interface EmployeeDetailFormValues {
	firstName: string;
	lastName: string;
	gender: "male" | "female" | "other" | undefined;
	pronouns: string;
	position: string;
	employeeNumber: string;
	startDate: string;
	role: "admin" | "manager" | "employee" | undefined;
	contractType: "fixed" | "hourly";
	hourlyRate: string;
	canUseWebapp: boolean;
	canUseDesktop: boolean;
	canUseMobile: boolean;
}
```

In `defaultFormValues`, add the new property after `employeeNumber`:

```ts
	startDate: "",
```

Add these helpers below `scheduleDayKeys`:

```ts
export function formatEmployeeDetailDateInputValue(value: Date | string | null | undefined) {
	if (!value) return "";
	const date = value instanceof Date ? DateTime.fromJSDate(value, { zone: "utc" }) : DateTime.fromISO(value, { zone: "utc" });
	return date.isValid ? date.toISODate() ?? "" : "";
}

export function parseEmployeeDetailDateInputValue(value: string) {
	if (!value) return null;
	const date = DateTime.fromISO(value, { zone: "utc" }).startOf("day");
	return date.isValid ? date.toJSDate() : null;
}

export function buildEmployeeUpdatePayload(value: EmployeeDetailFormValues) {
	return {
		...value,
		startDate: parseEmployeeDetailDateInputValue(value.startDate),
	};
}
```

In `syncEmployeeForm`, set the form value after `employeeNumber`:

```ts
	form.setFieldValue("startDate", formatEmployeeDetailDateInputValue(employee.startDate));
```

- [ ] **Step 4: Run the new test and verify it passes**

Run:

```bash
pnpm --filter webapp test -- src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.ts apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.test.ts
git commit -m "feat: add employee start date form helpers"
```

---

### Task 2: Render And Submit The Employee Start Date Field

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx`

- [ ] **Step 1: Wire the tested submit conversion into the client component**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`, update the import from `./page-utils` to include the tested payload helper:

```ts
import {
	buildEmployeeUpdatePayload,
	defaultFormValues,
	focusFirstInvalidEmployeeDetailField,
	syncEmployeeForm,
} from "./page-utils";
```

Update the submit handler:

```ts
		onSubmit: async ({ value }) => {
			const payload = buildEmployeeUpdatePayload(value);
			const result = await updateEmployee(payload).catch(() => null);
```

- [ ] **Step 2: Run the helper test after wiring submit conversion**

Run:

```bash
pnpm --filter webapp test -- src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.test.ts
```

Expected: PASS. This confirms the helper used by the submit handler converts blank dates to `null` and date input strings to UTC `Date` values.

- [ ] **Step 3: Add the `Start date` field UI**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx`, add this field inside the existing grid that currently contains `Position` and `Employee Number`, immediately after `Employee Number`:

```tsx
						<form.Field name="startDate">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.employees.detailView.startDate", "Start date")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="startDate"
											type="date"
											autoComplete="off"
											value={field.state.value || ""}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											disabled={!canEditManagerFields || isUpdating}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.employees.detailView.startDateDescription",
											"Work-balance tracking starts on this date",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
```

The grid will now have three items. This preserves responsive layout: two columns on `md`, stacked on mobile.

- [ ] **Step 4: Run focused validation**

Run:

```bash
pnpm --filter webapp test -- src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/employee-detail-page-client.tsx apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-sections.tsx
git commit -m "feat: expose employee start date setting"
```

---

### Task 3: Clip Period Aggregation Source Queries To Calculation Start Date

**Files:**
- Modify: `apps/webapp/src/lib/work-balance/period-aggregation.test.ts`
- Modify: `apps/webapp/src/lib/work-balance/period-aggregation.ts`

- [ ] **Step 1: Write the failing period clipping test**

Add this test after `computes employee period balances from completed work periods and daily requirements` in `apps/webapp/src/lib/work-balance/period-aggregation.test.ts`:

```ts
	it("clips period source queries to the employee calculation start date", async () => {
		mockState.selectWhere.mockResolvedValueOnce([{ totalMinutes: 480 }]);
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValueOnce({
			"2026-05-10": { requiredMinutes: 480 },
		});

		const result = await computeEmployeePeriodBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-05-01",
			periodEnd: "2026-05-31",
			calculationStartDate: "2026-05-10",
			isClosed: true,
			now: new Date("2026-06-01T08:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				periodStart: "2026-05-01",
				periodEnd: "2026-05-31",
				actualMinutes: 480,
				requiredMinutes: 480,
			}),
		);
		expect(gte).toHaveBeenCalledWith(workPeriod.startTime, new Date("2026-05-10T00:00:00.000Z"));
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			startDate: new Date("2026-05-10T00:00:00.000Z"),
			endDate: new Date("2026-05-31T23:59:59.999Z"),
		});
	});

	it("returns a zero period when the calculation start date is after the period end", async () => {
		const result = await computeEmployeePeriodBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-05-01",
			periodEnd: "2026-05-31",
			calculationStartDate: "2026-06-10",
			isClosed: false,
			now: new Date("2026-05-22T08:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				periodStart: "2026-05-01",
				periodEnd: "2026-05-31",
				actualMinutes: 0,
				requiredMinutes: 0,
				balanceMinutes: 0,
			}),
		);
		expect(mockState.db.select).not.toHaveBeenCalled();
		expect(mockState.getDailyWorkRequirementsForEmployee).not.toHaveBeenCalled();
	});
```

- [ ] **Step 2: Run the period aggregation test and verify it fails**

Run:

```bash
pnpm --filter webapp test -- src/lib/work-balance/period-aggregation.test.ts
```

Expected: FAIL because `calculationStartDate` is not accepted and periods after the effective calculation range are not short-circuited.

- [ ] **Step 3: Implement optional `calculationStartDate` clipping**

Modify the input type in `apps/webapp/src/lib/work-balance/period-aggregation.ts`:

```ts
export async function computeEmployeePeriodBalance(input: {
	employeeId: string;
	organizationId: string;
	dbClient?: PeriodAggregationDbClient;
	periodType: EmployeeWorkBalancePeriodType;
	periodStart: string;
	periodEnd: string;
	calculationStartDate?: string | null;
	isClosed: boolean;
	now?: Date;
}) {
```

Replace the current `startDate` and `endDate` declarations with:

```ts
	const periodStart = DateTime.fromISO(input.periodStart, { zone: "utc" }).startOf("day");
	const periodEnd = DateTime.fromISO(input.periodEnd, { zone: "utc" }).endOf("day");
	const calculationStart = input.calculationStartDate
		? DateTime.fromISO(input.calculationStartDate, { zone: "utc" }).startOf("day")
		: null;
	const effectiveStart = calculationStart && calculationStart > periodStart ? calculationStart : periodStart;
	if (effectiveStart > periodEnd) {
		return buildPeriodBalanceValues({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			periodType: input.periodType,
			periodStart: input.periodStart,
			periodEnd: input.periodEnd,
			actualMinutes: 0,
			requiredMinutes: 0,
			computedAt: input.now ?? new Date(),
			isClosed: input.isClosed,
		});
	}
	const startDate = effectiveStart.toJSDate();
	const endDate = periodEnd.toJSDate();
```

Leave `periodStart` and `periodEnd` in the returned values unchanged. Only the source-data query range is clipped.

- [ ] **Step 4: Run the period aggregation test and verify it passes**

Run:

```bash
pnpm --filter webapp test -- src/lib/work-balance/period-aggregation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/webapp/src/lib/work-balance/period-aggregation.ts apps/webapp/src/lib/work-balance/period-aggregation.test.ts
git commit -m "feat: clip balance periods to employee start date"
```

---

### Task 4: Use Employee Start Date In All-Time Work Balance Refresh

**Files:**
- Modify: `apps/webapp/src/lib/work-balance/service.test.ts`
- Modify: `apps/webapp/src/lib/work-balance/service.ts`

- [ ] **Step 1: Update compute tests to prefer explicit start date**

In `apps/webapp/src/lib/work-balance/service.test.ts`, rename the test `uses the first completed work period when it follows the account` to:

```ts
	it("uses employee start date before the first completed work period", async () => {
```

In that test, change the expected computed start and requirement query start:

```ts
		expect(result).toEqual(
			expect.objectContaining({
				computedFromDate: "2026-05-01",
				actualMinutes: 480,
				requiredMinutes: 480,
				balanceMinutes: 0,
			}),
		);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: new Date("2026-05-01T00:00:00.000Z"),
			}),
		);
```

This test now fails until `getFirstRelevantDate` uses `employee.startDate`.

- [ ] **Step 2: Add a refresh test for clamped dirty dates and period calls**

Add this test before `keeps null dirty date stale refreshes scoped to the hot window`:

```ts
	it("does not rebuild closed months before employee start date", async () => {
		const now = new Date("2026-05-22T12:00:00.000Z");
		mockState.db.query.employee.findFirst.mockResolvedValueOnce({
			id: "employee-1",
			startDate: new Date("2026-02-10T00:00:00.000Z"),
		});
		mockState.computeEmployeePeriodBalance
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-02-01",
				periodEnd: "2026-02-28",
				actualMinutes: 100,
				requiredMinutes: 80,
				balanceMinutes: 20,
				computedAt: now,
				isClosed: true,
			})
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-03-01",
				periodEnd: "2026-05-22",
				actualMinutes: 300,
				requiredMinutes: 240,
				balanceMinutes: 60,
				computedAt: now,
				isClosed: false,
			});
		mockState.db.select.mockReturnValueOnce({ from: mockState.selectFrom });
		mockState.selectFrom.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere.mockResolvedValueOnce([
			{ actualMinutes: 100, requiredMinutes: 80, firstPeriodStart: "2026-02-01" },
		]);

		await refreshEmployeeWorkBalanceFromPeriods({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-01-01",
			now,
		});

		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(1, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-02-01",
			periodEnd: "2026-02-28",
			calculationStartDate: "2026-02-10",
			isClosed: true,
			now,
		});
		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(2, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-03-01",
			periodEnd: "2026-05-22",
			calculationStartDate: "2026-02-10",
			isClosed: false,
			now,
		});
		expect(mockState.computeEmployeePeriodBalance).toHaveBeenCalledTimes(2);
	});
```

- [ ] **Step 3: Run service tests and verify they fail**

Run:

```bash
pnpm --filter webapp test -- src/lib/work-balance/service.test.ts
```

Expected: FAIL because service still starts from the first work period and does not pass `calculationStartDate`.

- [ ] **Step 4: Implement start-date relevant-date helper**

In `apps/webapp/src/lib/work-balance/service.ts`, add these helpers after `getWorkBalanceBatchCutoffDate`:

```ts
function toUtcIsoDate(value: Date | string | null | undefined) {
	if (!value) return null;
	const date = value instanceof Date ? DateTime.fromJSDate(value, { zone: "utc" }) : DateTime.fromISO(value, { zone: "utc" });
	return date.isValid ? date.toISODate() : null;
}

function maxIsoDate(left: string, right: string) {
	return left > right ? left : right;
}

async function getEmployeeStartDate(
	input: { employeeId: string; organizationId: string },
	dbClient: WorkBalanceDbClient = db,
) {
	const scopedEmployee = await dbClient.query.employee.findFirst({
		where: and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		columns: { id: true, startDate: true },
	});
	if (!scopedEmployee) return null;
	return toUtcIsoDate(scopedEmployee.startDate);
}
```

Modify `getFirstRelevantDate` so the employee query reads `startDate` and returns it when present:

```ts
	const scopedEmployee = await dbClient.query.employee.findFirst({
		where: and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		columns: { id: true, startDate: true },
	});
	if (!scopedEmployee) return null;

	const employeeStartDate = toUtcIsoDate(scopedEmployee.startDate);
	if (employeeStartDate) return employeeStartDate;
```

Leave the first-work-period fallback below it unchanged.

- [ ] **Step 5: Clamp compute range for future start dates**

In `computeEmployeeWorkBalance`, after `start` and `through` are created, add:

```ts
	if (start > through) {
		return buildWorkBalanceValues({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			actualMinutes: 0,
			requiredMinutes: 0,
			computedFromDate: through.toISODate()!,
			computedThroughDate: through.toISODate()!,
			computedAt: input.now ?? new Date(),
		});
	}
```

This prevents pre-start employees from accumulating negative required minutes before their first day.

- [ ] **Step 6: Clamp period refresh and pass calculation start date**

In `refreshEmployeeWorkBalanceFromPeriodsLocked`, replace:

```ts
	const fullRebuildStartDate = forceFullRebuild ? await getFirstRelevantDate(input, dbClient) : null;
	const affectedStartDate = fullRebuildStartDate ?? input.dirtyFromDate ?? hotWindow.startDate;
```

with:

```ts
	const employeeStartDate = await getEmployeeStartDate(input, dbClient);
	const fullRebuildStartDate = forceFullRebuild ? await getFirstRelevantDate(input, dbClient) : null;
	const calculationStartDate = employeeStartDate ?? fullRebuildStartDate;
	const requestedAffectedStartDate = forceFullRebuild
		? fullRebuildStartDate
		: input.dirtyFromDate ?? hotWindow.startDate;
	const affectedStartDate = calculationStartDate && requestedAffectedStartDate
		? maxIsoDate(calculationStartDate, requestedAffectedStartDate)
		: requestedAffectedStartDate ?? hotWindow.startDate;
```

In both `computeEmployeePeriodBalance` calls, add `calculationStartDate`:

```ts
				calculationStartDate,
```

The closed-month call should include it between `periodEnd` and `isClosed`. The hot-window call should include it between `periodEnd` and `isClosed`.

- [ ] **Step 7: Run service tests and fix expected call objects**

Run:

```bash
pnpm --filter webapp test -- src/lib/work-balance/service.test.ts
```

Expected: Some existing `toHaveBeenNthCalledWith` assertions fail because every `computeEmployeePeriodBalance` call now includes `calculationStartDate`. Update those expected objects to include either:

```ts
			calculationStartDate: null,
```

or the expected ISO date, depending on the test setup.

Run again until expected output is PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/webapp/src/lib/work-balance/service.ts apps/webapp/src/lib/work-balance/service.test.ts
git commit -m "feat: start work balances from employee start date"
```

---

### Task 5: Final Verification

**Files:**
- Verify all files changed in Tasks 1-4.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter webapp test -- src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.test.ts src/lib/work-balance/period-aggregation.test.ts src/lib/work-balance/service.test.ts src/app/[locale]/\(app\)/settings/employees/employee-mutations.actions.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full webapp test suite**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS.

- [ ] **Step 3: Run production build if tests pass**

Run:

```bash
CI=true pnpm build
```

Expected: PASS. If this fails because required environment variables are unavailable to agents, stop and report which environment-gated check could not run.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat
git diff -- apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.ts apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.test.ts apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/employee-detail-page-client.tsx apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-sections.tsx apps/webapp/src/lib/work-balance/period-aggregation.ts apps/webapp/src/lib/work-balance/period-aggregation.test.ts apps/webapp/src/lib/work-balance/service.ts apps/webapp/src/lib/work-balance/service.test.ts
```

Expected: Only intentional employee start-date UI and work-balance calculation changes are present.

- [ ] **Step 5: Commit final verification notes only if files changed during verification**

If verification required no code changes, do not create an empty commit.

If verification required fixes, commit them:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.ts apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-utils.test.ts apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/employee-detail-page-client.tsx apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/page-sections.tsx apps/webapp/src/lib/work-balance/period-aggregation.ts apps/webapp/src/lib/work-balance/period-aggregation.test.ts apps/webapp/src/lib/work-balance/service.ts apps/webapp/src/lib/work-balance/service.test.ts
git commit -m "fix: verify employee start date balance behavior"
```

---

## Self-Review

Spec coverage:

- Existing `employee.startDate` is reused with no migration: covered by Tasks 1, 2, and 4.
- UI can set and clear the field: covered by Tasks 1 and 2.
- The runner starts required and actual calculations no earlier than start date: covered by Tasks 3 and 4.
- Dirty marking on start-date changes remains in existing action: covered by the existing `employee-mutations.actions.test.ts` included in Task 5 verification.
- Organization scoping remains on employee and work-period queries: covered by unchanged `eq(employee.organizationId, input.organizationId)` and `eq(workPeriod.organizationId, input.organizationId)` expectations in service tests.

Placeholder scan: no red-flag placeholder markers are present. Each code-changing step includes concrete code or exact expected edits.

Type consistency: `startDate` is a string in `EmployeeDetailFormValues`, converted to `Date | null` before calling `updateEmployee`, and `calculationStartDate` is `string | null | undefined` in work-balance period aggregation.
