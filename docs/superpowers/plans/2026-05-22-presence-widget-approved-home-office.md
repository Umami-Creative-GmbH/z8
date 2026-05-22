# Presence Widget Approved Home Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard presence widget account for approved additional home-office requests when calculating office days still required and home-office days left.

**Architecture:** Keep presence policy math in `actions/presence-status.ts` as pure functions. Keep authorization and organization-scoped database access in `actions.ts`, where `getPresenceStatus` already resolves the employee, policy, period, and work periods.

**Tech Stack:** Next.js server actions, Drizzle ORM, Effect services, Luxon, Vitest, pnpm.

---

## File Map

- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`
  - Add approved home-office exception dates as an optional pure input to `calculatePresenceStatusSummary`.
  - Add a small date-range expansion helper for approved absence ranges.
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`
  - Add failing tests for fixed-day exceptions, minimum-count exceptions, and range deduplication/clipping.
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
  - Import `absenceEntry` and `absenceCategory`.
  - Query approved `home_office` absences for the active organization, employee, and presence period.
  - Pass expanded exception dates into the summary helper.

## Task 1: Add Failing Pure Helper Tests

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`

- [ ] **Step 1: Import the date expansion helper in the test file**

Change the import at the top of `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts` to include `expandApprovedHomeOfficeDates`:

```ts
import {
	calculatePresenceStatusCounts,
	calculatePresenceStatusSummary,
	expandApprovedHomeOfficeDates,
	getPresencePeriodBounds,
	getPresenceWorkDays,
	parsePresenceFixedDays,
	validatePresenceFixedDaysConfig,
} from "./presence-status";
```

- [ ] **Step 2: Add failing tests for approved home-office exceptions**

Append these tests inside the existing `describe("calculatePresenceStatusSummary", () => { ... })` block, after the current last test:

```ts
	it("does not require a fixed office day with an approved home-office exception", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["wednesday"],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-06T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [],
			approvedHomeOfficeDates: ["2026-05-06"],
		});

		expect(summary.requiredOfficeDays).toBe(0);
		expect(summary.officeDaysRequiredLeft).toBe(0);
		expect(summary.homeOfficeDaysLeft).toBe(5);
	});

	it("reduces flexible required office days by approved home-office exceptions", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 5,
			requiredOnsiteFixedDays: [],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-04T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [],
			approvedHomeOfficeDates: ["2026-05-06", "2026-05-07"],
		});

		expect(summary.requiredOfficeDays).toBe(3);
		expect(summary.officeDaysRequiredLeft).toBe(3);
		expect(summary.homeOfficeDaysLeft).toBe(2);
	});
```

- [ ] **Step 3: Add failing tests for approved home-office date expansion**

Append this new `describe` block after the `calculatePresenceStatusSummary` block:

```ts
describe("expandApprovedHomeOfficeDates", () => {
	it("deduplicates and clips approved ranges to the presence period", () => {
		const dates = expandApprovedHomeOfficeDates({
			periodStart,
			periodEnd,
			timezone: "utc",
			entries: [
				{ startDate: "2026-05-03", endDate: "2026-05-06" },
				{ startDate: "2026-05-06", endDate: "2026-05-12" },
			],
		});

		expect(dates).toEqual([
			"2026-05-04",
			"2026-05-05",
			"2026-05-06",
			"2026-05-07",
			"2026-05-08",
			"2026-05-09",
			"2026-05-10",
		]);
	});

	it("ignores malformed approved ranges", () => {
		const dates = expandApprovedHomeOfficeDates({
			periodStart,
			periodEnd,
			timezone: "utc",
			entries: [
				{ startDate: "not-a-date", endDate: "2026-05-06" },
				{ startDate: "2026-05-08", endDate: "2026-05-07" },
			],
		});

		expect(dates).toEqual([]);
	});
});
```

- [ ] **Step 4: Run the helper tests and verify they fail**

Run:

```bash
pnpm test -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
```

Expected: FAIL because `expandApprovedHomeOfficeDates` is not exported and `approvedHomeOfficeDates` is not accepted by `calculatePresenceStatusSummary`.

- [ ] **Step 5: Commit the failing tests if commit approval exists**

Only run this if the session has explicit approval to create commits:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
git commit -m "test: cover approved home office presence exceptions"
```

## Task 2: Implement Approved Home-Office Exception Math

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`

- [ ] **Step 1: Add the date expansion helper**

Add this function after `getPresencePeriodBounds` in `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`:

```ts
export function expandApprovedHomeOfficeDates({
	entries,
	periodStart,
	periodEnd,
	timezone,
}: {
	entries: Array<{ startDate: string; endDate: string }>;
	periodStart: DateTime;
	periodEnd: DateTime;
	timezone: string;
}): string[] {
	const zone = timezone || "utc";
	const start = periodStart.setZone(zone).startOf("day");
	const end = periodEnd.setZone(zone).endOf("day");
	const dates = new Set<string>();

	for (const entry of entries) {
		let cursor = DateTime.fromISO(entry.startDate, { zone }).startOf("day");
		const entryEnd = DateTime.fromISO(entry.endDate, { zone }).startOf("day");

		if (!cursor.isValid || !entryEnd.isValid || entryEnd < cursor) continue;
		if (cursor < start) cursor = start;
		const clippedEnd = entryEnd > end ? end.startOf("day") : entryEnd;

		while (cursor <= clippedEnd) {
			const date = cursor.toISODate();
			if (date) dates.add(date);
			cursor = cursor.plus({ days: 1 });
		}
	}

	return Array.from(dates).sort();
}
```

- [ ] **Step 2: Add the approved date input to `calculatePresenceStatusSummary`**

Update the function destructuring and parameter type in `calculatePresenceStatusSummary`:

```ts
export function calculatePresenceStatusSummary({
	presenceMode,
	requiredOnsiteDays,
	requiredOnsiteFixedDays,
	period,
	periodStart,
	periodEnd,
	now,
	timezone,
	workDays,
	workPeriods,
	approvedHomeOfficeDates = [],
}: {
	presenceMode: PresenceMode;
	requiredOnsiteDays: number | null;
	requiredOnsiteFixedDays: PresenceDayOfWeek[] | null;
	period: PresenceEvaluationPeriod;
	periodStart: DateTime;
	periodEnd: DateTime;
	now: DateTime;
	timezone: string;
	workDays: PresenceDayOfWeek[] | null;
	workPeriods: Array<{ startTime: Date; workLocationType: string | null }>;
	approvedHomeOfficeDates?: string[];
}): PresenceStatusSummary {
```

- [ ] **Step 3: Apply exception dates in the summary calculation**

Inside `calculatePresenceStatusSummary`, after `workedDates` is declared, add:

```ts
	const approvedHomeOfficeDateSet = new Set(approvedHomeOfficeDates);
```

Then replace the body of the `while (cursor <= end) { ... }` loop with:

```ts
	while (cursor <= end) {
		const weekday = WEEKDAY_BY_NUMBER[cursor.weekday];
		const date = cursor.toISODate();
		const hasApprovedHomeOffice = date ? approvedHomeOfficeDateSet.has(date) : false;

		if (
			date &&
			presenceMode === "fixed_days" &&
			fixedOfficeDaySet.has(weekday) &&
			!hasApprovedHomeOffice
		) {
			fixedOfficeDates += 1;
			if (cursor >= today && !officeDates.has(date)) {
				officeDaysRequiredLeft += 1;
			}
		}

		if (date && scheduledDays.has(weekday)) {
			totalScheduledWorkDays += 1;

			const isRemaining = cursor >= today && !workedDates.has(date);
			if (isRemaining) {
				workingDaysRemaining += 1;
			}

			if (
				presenceMode === "fixed_days" &&
				(!fixedOfficeDaySet.has(weekday) || hasApprovedHomeOffice) &&
				isRemaining
			) {
				homeOfficeDaysLeft += 1;
			}
		}

		cursor = cursor.plus({ days: 1 });
	}
```

Then replace the `requiredOfficeDays` calculation with:

```ts
	const approvedScheduledHomeOfficeDays = Array.from(approvedHomeOfficeDateSet).filter((date) => {
		const dateTime = DateTime.fromISO(date, { zone });
		if (!dateTime.isValid || dateTime < start || dateTime > end) return false;
		return scheduledDays.has(WEEKDAY_BY_NUMBER[dateTime.weekday]);
	}).length;
	const requiredOfficeDays =
		presenceMode === "minimum_count"
			? Math.min(
					requiredOnsiteDays ?? 0,
					Math.max(totalScheduledWorkDays - approvedScheduledHomeOfficeDays, 0),
				)
			: fixedOfficeDates;
```

- [ ] **Step 4: Run the helper tests and verify they pass**

Run:

```bash
pnpm test -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the helper implementation if commit approval exists**

Only run this if the session has explicit approval to create commits:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
git commit -m "feat: apply approved home office presence exceptions"
```

## Task 3: Wire Approved Home-Office Absences Into `getPresenceStatus`

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`

- [ ] **Step 1: Import absence tables and the expansion helper**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`, add `absenceCategory` and `absenceEntry` to the schema import:

```ts
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	employee,
	project,
	projectAssignment,
	surchargeCalculation,
	timeEntry,
	userSettings,
	workPeriod,
	workPolicy,
	workPolicyPresence,
} from "@/db/schema";
```

Also add `expandApprovedHomeOfficeDates` to the presence helper import:

```ts
import {
	calculatePresenceStatusSummary,
	expandApprovedHomeOfficeDates,
	getPresencePeriodBounds,
	getPresenceWorkDays,
	type PresenceEvaluationPeriod,
	type PresenceStatusSummary,
	parsePresenceFixedDays,
	validatePresenceFixedDaysConfig,
} from "./actions/presence-status";
```

- [ ] **Step 2: Query approved home-office absences in the presence period**

In `getPresenceStatus`, after the existing `periods` query and before `return calculatePresenceStatusSummary({ ... })`, add:

```ts
		const approvedHomeOfficeEntries = yield* _(
			dbService.query("getApprovedHomeOfficeEntries", async () => {
				return await dbService.db
					.select({
						startDate: absenceEntry.startDate,
						endDate: absenceEntry.endDate,
					})
					.from(absenceEntry)
					.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
					.where(
						and(
							eq(absenceEntry.employeeId, validatedEmployeeId),
							eq(absenceEntry.organizationId, session.session.activeOrganizationId!),
							eq(absenceEntry.status, "approved"),
							eq(absenceCategory.organizationId, session.session.activeOrganizationId!),
							eq(absenceCategory.type, "home_office"),
							lte(absenceEntry.startDate, periodEnd.toISODate() ?? ""),
							gte(absenceEntry.endDate, periodStart.toISODate() ?? ""),
						),
					);
			}),
		);

		const approvedHomeOfficeDates = expandApprovedHomeOfficeDates({
			entries: approvedHomeOfficeEntries,
			periodStart,
			periodEnd,
			timezone,
		});
```

- [ ] **Step 3: Pass approved dates into the summary helper**

Update the `calculatePresenceStatusSummary` call at the end of `getPresenceStatus`:

```ts
		return calculatePresenceStatusSummary({
			presenceMode: presenceConfig.presenceMode,
			requiredOnsiteDays: presenceConfig.requiredOnsiteDays,
			requiredOnsiteFixedDays: fixedOfficeDays,
			period: presenceConfig.evaluationPeriod,
			periodStart,
			periodEnd,
			now,
			timezone,
			workDays: getPresenceWorkDays(effectivePolicy.schedule?.days ?? null),
			workPeriods: periods,
			approvedHomeOfficeDates,
		});
```

- [ ] **Step 4: Run the focused helper tests**

Run:

```bash
pnpm test -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run type-aware verification for the edited package**

Run:

```bash
CI=true pnpm build
```

Expected: PASS. If it fails for unrelated pre-existing issues, record the failure and run the narrow test command from Step 4 again after any necessary local fix.

- [ ] **Step 6: Commit the server wiring if commit approval exists**

Only run this if the session has explicit approval to create commits:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
git commit -m "feat: include approved home office in presence status"
```

## Task 4: Final Verification

**Files:**
- Verify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Verify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`
- Verify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`

- [ ] **Step 1: Run the focused test suite**

Run:

```bash
pnpm test -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git diff -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts docs/superpowers/specs/2026-05-22-presence-widget-approved-home-office-design.md docs/superpowers/plans/2026-05-22-presence-widget-approved-home-office.md
```

Expected: Diff only contains the approved home-office presence exception work and the spec/plan documents.

- [ ] **Step 4: Final commit if commit approval exists**

Only run this if there are uncommitted implementation changes and the session has explicit approval to create commits:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts docs/superpowers/specs/2026-05-22-presence-widget-approved-home-office-design.md docs/superpowers/plans/2026-05-22-presence-widget-approved-home-office.md
git commit -m "feat: account for approved home office in presence widget"
```

## Self-Review

- Spec coverage: The plan covers server-side loading of approved `home_office` absence entries, date expansion, fixed-day exception math, minimum-count exception math, deduplication, period clipping, organization scoping, and verification.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: The plan consistently uses `approvedHomeOfficeDates?: string[]`, `expandApprovedHomeOfficeDates`, `absenceEntry.startDate`, `absenceEntry.endDate`, and existing `PresenceStatusSummary` fields.
