# Presence Widget Home Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard Presence widget with a work-location status card that shows home-office days left and office days still required from the effective presence policy.

**Architecture:** Move policy-period and home-office allowance calculations into `actions/presence-status.ts` as pure, testable helpers. Keep organization authorization and database lookup in `actions.ts`, then render the returned summary in `presence-status-widget.tsx` without duplicating policy rules in the client.

**Tech Stack:** Next.js server actions, Effect services, Drizzle ORM, Luxon, TanStack Query, React, Tolgee, Vitest, Testing Library, pnpm.

---

## File Map

- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`
  - Owns presence period calculation, fixed-day parsing, workday enumeration, and pure summary calculation.
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`
  - Unit tests for all helper behavior before server action wiring.
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
  - Keeps auth/org scope checks, loads effective policy, presence config, and period work periods, then calls the helper.
- Modify: `apps/webapp/src/lib/query/use-time-clock.presence.test.tsx`
  - Extends existing clock mutation tests to invalidate the presence status query after location changes.
- Create: `apps/webapp/src/components/dashboard/presence-status-widget.test.tsx`
  - Component tests for two equal stats, fixed-days note, hidden disabled policy, and unavailable state.
- Modify: `apps/webapp/src/components/dashboard/presence-status-widget.tsx`
  - Renders the redesigned card with two equal stats and policy notes.

## Task 1: Pure Presence Summary Helper

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`

- [ ] **Step 1: Replace the existing narrow helper tests with failing summary tests**

Replace `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts` with:

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	calculatePresenceStatusCounts,
	calculatePresenceStatusSummary,
	parsePresenceFixedDays,
} from "./presence-status";

const periodStart = DateTime.fromISO("2026-05-04T00:00:00.000Z", { zone: "utc" });
const periodEnd = DateTime.fromISO("2026-05-10T23:59:59.999Z", { zone: "utc" });

describe("calculatePresenceStatusCounts", () => {
	it("does not let an office day satisfy a different fixed on-site day", () => {
		const counts = calculatePresenceStatusCounts({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["friday"],
			workPeriods: [
				{
					startTime: new Date("2026-05-04T09:00:00.000Z"),
					workLocationType: "office",
				},
			],
		});

		expect(counts).toEqual({ actual: 0, required: 1 });
	});
});

describe("parsePresenceFixedDays", () => {
	it("returns valid configured weekdays", () => {
		expect(parsePresenceFixedDays('["monday","wednesday"]')).toEqual([
			"monday",
			"wednesday",
		]);
	});

	it("rejects malformed fixed day JSON", () => {
		expect(parsePresenceFixedDays("not-json")).toBeNull();
		expect(parsePresenceFixedDays('["monday","funday"]')).toBeNull();
	});
});

describe("calculatePresenceStatusSummary", () => {
	it("calculates flexible home-office days left and office days required", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 3,
			requiredOnsiteFixedDays: [],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-06T12:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [
				{ startTime: new Date("2026-05-04T09:00:00.000Z"), workLocationType: "office" },
				{ startTime: new Date("2026-05-05T09:00:00.000Z"), workLocationType: "home" },
			],
		});

		expect(summary).toMatchObject({
			available: true,
			homeOfficeDaysLeft: 1,
			officeDaysRequiredLeft: 2,
			officeDaysCompleted: 1,
			homeOfficeDaysUsed: 1,
			workingDaysRemaining: 3,
			requiredOfficeDays: 3,
		});
	});

	it("uses office requirement before flexible home-office allowance", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 3,
			requiredOnsiteFixedDays: [],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-08T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [{ startTime: new Date("2026-05-04T09:00:00.000Z"), workLocationType: "office" }],
		});

		expect(summary.homeOfficeDaysLeft).toBe(0);
		expect(summary.officeDaysRequiredLeft).toBe(2);
		expect(summary.workingDaysRemaining).toBe(1);
	});

	it("calculates fixed office weekdays and remaining home-office days", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["monday", "wednesday"],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-05T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [{ startTime: new Date("2026-05-04T09:00:00.000Z"), workLocationType: "office" }],
		});

		expect(summary).toMatchObject({
			homeOfficeDaysLeft: 3,
			officeDaysRequiredLeft: 1,
			requiredOfficeDays: 2,
			fixedOfficeDays: ["monday", "wednesday"],
		});
	});

	it("counts multiple work periods on one date once and keeps remote distinct from home", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 2,
			requiredOnsiteFixedDays: [],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-06T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [
				{ startTime: new Date("2026-05-04T09:00:00.000Z"), workLocationType: "office" },
				{ startTime: new Date("2026-05-04T13:00:00.000Z"), workLocationType: "office" },
				{ startTime: new Date("2026-05-05T09:00:00.000Z"), workLocationType: "remote" },
				{ startTime: new Date("2026-05-06T09:00:00.000Z"), workLocationType: "home" },
			],
		});

		expect(summary.officeDaysCompleted).toBe(1);
		expect(summary.homeOfficeDaysUsed).toBe(1);
	});
});
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run:

```bash
pnpm test -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
```

Expected: FAIL because `calculatePresenceStatusSummary` and `parsePresenceFixedDays` are not exported.

- [ ] **Step 3: Implement the summary helper**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`, keep `calculatePresenceStatusCounts` for compatibility and add these exports below the existing weekday constants:

```ts
export type PresenceEvaluationPeriod = "weekly" | "biweekly" | "monthly";

const PRESENCE_DAY_SET = new Set<PresenceDayOfWeek>([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

export type PresenceStatusSummary = {
	presenceEnabled: boolean;
	available: boolean;
	period: PresenceEvaluationPeriod;
	periodStart: string;
	periodEnd: string;
	mode: PresenceMode;
	homeOfficeDaysLeft: number;
	officeDaysRequiredLeft: number;
	officeDaysCompleted: number;
	homeOfficeDaysUsed: number;
	workingDaysRemaining: number;
	requiredOfficeDays: number;
	fixedOfficeDays: PresenceDayOfWeek[];
	message: string | null;
};

export function parsePresenceFixedDays(value: string | null): PresenceDayOfWeek[] | null {
	if (!value) return [];

	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return null;

		const days: PresenceDayOfWeek[] = [];
		for (const item of parsed) {
			if (typeof item !== "string" || !PRESENCE_DAY_SET.has(item as PresenceDayOfWeek)) {
				return null;
			}
			days.push(item as PresenceDayOfWeek);
		}
		return days;
	} catch {
		return null;
	}
}

function isoDate(dateTime: DateTime): string {
	return dateTime.toISODate() ?? dateTime.toFormat("yyyy-MM-dd");
}

function enumeratePeriodDates({
	periodStart,
	periodEnd,
	timezone,
}: {
	periodStart: DateTime;
	periodEnd: DateTime;
	timezone: string;
}) {
	const dates: DateTime[] = [];
	let cursor = periodStart.setZone(timezone).startOf("day");
	const end = periodEnd.setZone(timezone).startOf("day");

	while (cursor <= end) {
		dates.push(cursor);
		cursor = cursor.plus({ days: 1 });
	}

	return dates;
}

function buildWorkedDateSets(
	workPeriods: Array<{ startTime: Date; workLocationType: string | null }>,
	timezone: string,
) {
	const workedDates = new Set<string>();
	const officeDates = new Set<string>();
	const homeDates = new Set<string>();

	for (const period of workPeriods) {
		const dateKey = isoDate(DateTime.fromJSDate(period.startTime, { zone: timezone }));
		workedDates.add(dateKey);

		if (period.workLocationType === "office") {
			officeDates.add(dateKey);
		} else if (period.workLocationType === "home") {
			homeDates.add(dateKey);
		}
	}

	return { workedDates, officeDates, homeDates };
}

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
}: {
	presenceMode: PresenceMode;
	requiredOnsiteDays: number | null;
	requiredOnsiteFixedDays: PresenceDayOfWeek[];
	period: PresenceEvaluationPeriod;
	periodStart: DateTime;
	periodEnd: DateTime;
	now: DateTime;
	timezone: string;
	workDays: PresenceDayOfWeek[];
	workPeriods: Array<{ startTime: Date; workLocationType: string | null }>;
}): PresenceStatusSummary {
	const workDaySet = new Set(workDays);
	const fixedDaySet = new Set(requiredOnsiteFixedDays);
	const { workedDates, officeDates, homeDates } = buildWorkedDateSets(workPeriods, timezone);
	const dates = enumeratePeriodDates({ periodStart, periodEnd, timezone });
	const today = isoDate(now.setZone(timezone));

	const scheduledDates = dates.filter((date) => workDaySet.has(WEEKDAY_BY_NUMBER[date.weekday]));
	const remainingScheduledDates = scheduledDates.filter((date) => {
		const dateKey = isoDate(date);
		return dateKey >= today && !workedDates.has(dateKey);
	});

	const homeOfficeDaysUsed = Array.from(homeDates).filter((date) => !officeDates.has(date)).length;

	if (presenceMode === "fixed_days") {
		const requiredFixedDates = scheduledDates.filter((date) =>
			fixedDaySet.has(WEEKDAY_BY_NUMBER[date.weekday]),
		);
		const remainingRequiredFixedDates = requiredFixedDates.filter((date) => {
			const dateKey = isoDate(date);
			return dateKey >= today && !officeDates.has(dateKey);
		});
		const homeOfficeDatesLeft = remainingScheduledDates.filter(
			(date) => !fixedDaySet.has(WEEKDAY_BY_NUMBER[date.weekday]),
		);

		return {
			presenceEnabled: true,
			available: true,
			period,
			periodStart: periodStart.toISO() ?? "",
			periodEnd: periodEnd.toISO() ?? "",
			mode: presenceMode,
			homeOfficeDaysLeft: homeOfficeDatesLeft.length,
			officeDaysRequiredLeft: remainingRequiredFixedDates.length,
			officeDaysCompleted: officeDates.size,
			homeOfficeDaysUsed,
			workingDaysRemaining: remainingScheduledDates.length,
			requiredOfficeDays: requiredFixedDates.length,
			fixedOfficeDays: requiredOnsiteFixedDays,
			message: null,
		};
	}

	const requiredOfficeDays = Math.min(requiredOnsiteDays ?? 0, scheduledDates.length);
	const officeDaysRequiredLeft = Math.max(requiredOfficeDays - officeDates.size, 0);

	return {
		presenceEnabled: true,
		available: true,
		period,
		periodStart: periodStart.toISO() ?? "",
		periodEnd: periodEnd.toISO() ?? "",
		mode: presenceMode,
		homeOfficeDaysLeft: Math.max(remainingScheduledDates.length - officeDaysRequiredLeft, 0),
		officeDaysRequiredLeft,
		officeDaysCompleted: officeDates.size,
		homeOfficeDaysUsed,
		workingDaysRemaining: remainingScheduledDates.length,
		requiredOfficeDays,
		fixedOfficeDays: [],
		message: null,
	};
}
```

- [ ] **Step 4: Run the helper tests and verify they pass**

Run:

```bash
pnpm test -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
```

Expected: PASS for all presence-status helper tests.

- [ ] **Step 5: Commit the helper**

Run:

```bash
git add "apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts" "apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts"
git commit -m "feat: calculate home office presence summary"
```

## Task 2: Server Action Data Contract

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts`

- [ ] **Step 1: Add failing tests for period bounds and fallback workdays**

Update the existing import from `./presence-status` in `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts` to include `getPresencePeriodBounds` and `getPresenceWorkDays`, then append the test blocks below the existing tests:

```ts
describe("getPresencePeriodBounds", () => {
	it("returns monthly bounds for the current month", () => {
		const bounds = getPresencePeriodBounds({
			period: "monthly",
			now: DateTime.fromISO("2026-05-21T12:00:00.000Z", { zone: "utc" }),
			weekStartDay: 1,
			timezone: "utc",
		});

		expect(bounds.start.toISO()).toBe("2026-05-01T00:00:00.000Z");
		expect(bounds.end.toISO()).toBe("2026-05-31T23:59:59.999Z");
	});

	it("returns a two-week range for biweekly policies", () => {
		const bounds = getPresencePeriodBounds({
			period: "biweekly",
			now: DateTime.fromISO("2026-05-21T12:00:00.000Z", { zone: "utc" }),
			weekStartDay: 1,
			timezone: "utc",
		});

		expect(bounds.end.diff(bounds.start, "days").days).toBeCloseTo(14, 3);
		expect(bounds.start.weekday).toBe(1);
	});
});

describe("getPresenceWorkDays", () => {
	it("uses detailed schedule workdays when available", () => {
		expect(
			getPresenceWorkDays([
				{ dayOfWeek: "monday", isWorkDay: true },
				{ dayOfWeek: "tuesday", isWorkDay: false },
				{ dayOfWeek: "wednesday", isWorkDay: true },
			]),
		).toEqual(["monday", "wednesday"]);
	});

	it("falls back to Monday through Friday", () => {
		expect(getPresenceWorkDays(null)).toEqual([
			"monday",
			"tuesday",
			"wednesday",
			"thursday",
			"friday",
		]);
	});
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm test -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
```

Expected: FAIL because `getPresencePeriodBounds` and `getPresenceWorkDays` are not exported.

- [ ] **Step 3: Add period and workday helpers**

Add these exports to `actions/presence-status.ts`:

```ts
const DEFAULT_WORK_DAYS: PresenceDayOfWeek[] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
];

export function getPresenceWorkDays(
	scheduleDays: Array<{ dayOfWeek: string; isWorkDay: boolean }> | null,
): PresenceDayOfWeek[] {
	const days = scheduleDays
		?.filter((day) => day.isWorkDay && PRESENCE_DAY_SET.has(day.dayOfWeek as PresenceDayOfWeek))
		.map((day) => day.dayOfWeek as PresenceDayOfWeek);

	return days && days.length > 0 ? days : DEFAULT_WORK_DAYS;
}

export function getPresencePeriodBounds({
	period,
	now,
	weekStartDay,
	timezone,
}: {
	period: PresenceEvaluationPeriod;
	now: DateTime;
	weekStartDay: number;
	timezone: string;
}) {
	const zonedNow = now.setZone(timezone);

	if (period === "monthly") {
		return {
			start: zonedNow.startOf("month"),
			end: zonedNow.endOf("month"),
		};
	}

	const normalizedWeekStart = Math.min(Math.max(weekStartDay, 1), 7);
	const daysSinceWeekStart = (zonedNow.weekday - normalizedWeekStart + 7) % 7;
	const weekStart = zonedNow.minus({ days: daysSinceWeekStart }).startOf("day");

	if (period === "weekly") {
		return { start: weekStart, end: weekStart.plus({ days: 6 }).endOf("day") };
	}

	const anchor = DateTime.fromISO("2026-01-05T00:00:00.000Z", { zone: timezone });
	const weeksSinceAnchor = Math.floor(weekStart.diff(anchor, "weeks").weeks);
	const cycleStart = weekStart.minus({ weeks: ((weeksSinceAnchor % 2) + 2) % 2 });
	return { start: cycleStart, end: cycleStart.plus({ days: 13 }).endOf("day") };
}
```

- [ ] **Step 4: Update the server action return type and disabled summaries**

In `actions.ts`, update the imports from `./actions/presence-status` to include:

```ts
calculatePresenceStatusSummary,
getPresencePeriodBounds,
getPresenceWorkDays,
parsePresenceFixedDays,
type PresenceEvaluationPeriod,
type PresenceStatusSummary,
```

Change the `getPresenceStatus` return type to:

```ts
export async function getPresenceStatus(
	employeeId: string,
): Promise<ServerActionResult<PresenceStatusSummary>> {
```

Add a small local helper near the top of `getPresenceStatus` after `validatedEmployeeId`:

```ts
const disabledPresenceStatus: PresenceStatusSummary = {
	presenceEnabled: false,
	available: false,
	period: "weekly",
	periodStart: "",
	periodEnd: "",
	mode: "minimum_count",
	homeOfficeDaysLeft: 0,
	officeDaysRequiredLeft: 0,
	officeDaysCompleted: 0,
	homeOfficeDaysUsed: 0,
	workingDaysRemaining: 0,
	requiredOfficeDays: 0,
	fixedOfficeDays: [],
	message: null,
};
```

Replace each current disabled return object in the action with:

```ts
return disabledPresenceStatus;
```

- [ ] **Step 5: Wire policy period, schedule days, and summary calculation**

In `getPresenceStatus`, replace the current-week-only block from `const now = DateTime.now();` through the `return { required, actual, ... }` with:

```ts
const fixedDays = parsePresenceFixedDays(presenceConfig.requiredOnsiteFixedDays);
if (!fixedDays) {
	return {
		...disabledPresenceStatus,
		presenceEnabled: true,
		available: false,
		period: presenceConfig.evaluationPeriod,
		mode: presenceConfig.presenceMode,
		message: "Presence policy has invalid fixed office days.",
	};
}

const now = DateTime.now();
const weekStartDay = yield* _(Effect.promise(() => getUserWeekStartDay(session.user.id)));
const timezone = session.user.timezone ?? "Europe/Berlin";
const { start: periodStart, end: periodEnd } = getPresencePeriodBounds({
	period: presenceConfig.evaluationPeriod as PresenceEvaluationPeriod,
	now,
	weekStartDay,
	timezone,
});

const periods = yield* _(
	dbService.query("getPresencePeriodWorkPeriods", async () => {
		return await dbService.db.query.workPeriod.findMany({
			where: and(
				eq(workPeriod.employeeId, validatedEmployeeId),
				gte(workPeriod.startTime, periodStart.toJSDate()),
				lte(workPeriod.startTime, periodEnd.toJSDate()),
			),
			columns: {
				startTime: true,
				workLocationType: true,
			},
		});
	}),
);

return calculatePresenceStatusSummary({
	presenceMode: presenceConfig.presenceMode,
	requiredOnsiteDays: presenceConfig.requiredOnsiteDays,
	requiredOnsiteFixedDays: fixedDays,
	period: presenceConfig.evaluationPeriod as PresenceEvaluationPeriod,
	periodStart,
	periodEnd,
	now,
	timezone,
	workDays: getPresenceWorkDays(effectivePolicy.schedule?.days ?? null),
	workPeriods: periods,
});
```

If `session.user.timezone` is not a typed property in this codebase, use `const timezone = "Europe/Berlin";` and add a note in the implementation summary that user time zone is not currently available on the session type.

- [ ] **Step 6: Run tests for helper and server action type checking**

Run:

```bash
pnpm test -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts
CI=true pnpm build
```

Expected: helper tests PASS. Build PASS, or fail on pre-existing unrelated issues only after confirming no TypeScript errors from changed files.

- [ ] **Step 7: Commit the server action contract**

Run:

```bash
git add "apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts" "apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.ts" "apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts"
git commit -m "feat: return home office presence status"
```

## Task 3: Query Invalidation After Clock Location Changes

**Files:**
- Modify: `apps/webapp/src/lib/query/use-time-clock.presence.test.tsx`
- Modify: `apps/webapp/src/lib/query/use-time-clock.ts`

- [ ] **Step 1: Add failing invalidation assertions**

In `use-time-clock.presence.test.tsx`, update the clock-in test to assert presence invalidation for the active employee:

```ts
await waitFor(() => {
	expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.employeeClockStatuses.all });
	expect(invalidateSpy).toHaveBeenCalledWith({
		queryKey: queryKeys.workPolicies.presence.status("emp-1"),
	});
});
```

Update the clock-out test with the same extra assertion.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm test -- apps/webapp/src/lib/query/use-time-clock.presence.test.tsx
```

Expected: FAIL because presence status is not invalidated after clock mutations.

- [ ] **Step 3: Invalidate presence status after successful clock mutations**

In `apps/webapp/src/lib/query/use-time-clock.ts`, locate the existing successful `clockIn` and `clockOut` mutation handlers that invalidate `queryKeys.employeeClockStatuses.all`. Add this invalidation alongside them, using the current status employee id already returned by `getTimeClockStatus`:

```ts
if (status?.employeeId) {
	void queryClient.invalidateQueries({
		queryKey: queryKeys.workPolicies.presence.status(status.employeeId),
	});
}
```

If the hook names the current status object differently, use that existing variable rather than adding a new query.

- [ ] **Step 4: Run the invalidation test**

Run:

```bash
pnpm test -- apps/webapp/src/lib/query/use-time-clock.presence.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit query invalidation**

Run:

```bash
git add "apps/webapp/src/lib/query/use-time-clock.ts" "apps/webapp/src/lib/query/use-time-clock.presence.test.tsx"
git commit -m "fix: refresh presence status after clock changes"
```

## Task 4: Widget UI Redesign

**Files:**
- Create: `apps/webapp/src/components/dashboard/presence-status-widget.test.tsx`
- Modify: `apps/webapp/src/components/dashboard/presence-status-widget.tsx`

- [ ] **Step 1: Add failing component tests**

Create `apps/webapp/src/components/dashboard/presence-status-widget.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PresenceStatusWidget } from "./presence-status-widget";

const mocks = vi.hoisted(() => ({
	getCurrentEmployee: vi.fn(),
	usePresenceStatus: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string, params?: Record<string, unknown>) => {
		if (!params) return fallback;
		return Object.entries(params).reduce(
			(text, [key, value]) => text.replace(`{${key}}`, String(value)),
			fallback,
		);
	} }),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	getCurrentEmployee: mocks.getCurrentEmployee,
}));

vi.mock("@/hooks/use-presence-status", () => ({
	usePresenceStatus: mocks.usePresenceStatus,
}));

vi.mock("./dashboard-widget", () => ({
	DashboardWidget: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

function mockEmployee() {
	mocks.getCurrentEmployee.mockResolvedValue({ id: "emp-1" });
}

describe("PresenceStatusWidget", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders equal home-office and office-required stats", async () => {
		mockEmployee();
		mocks.usePresenceStatus.mockReturnValue({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: true,
				period: "weekly",
				periodStart: "2026-05-04T00:00:00.000Z",
				periodEnd: "2026-05-10T23:59:59.999Z",
				mode: "minimum_count",
				homeOfficeDaysLeft: 1,
				officeDaysRequiredLeft: 2,
				officeDaysCompleted: 1,
				homeOfficeDaysUsed: 1,
				workingDaysRemaining: 3,
				requiredOfficeDays: 3,
				fixedOfficeDays: [],
				message: null,
			},
		});

		render(<PresenceStatusWidget />);

		expect(await screen.findByText("Work location")).toBeInTheDocument();
		expect(screen.getByText("Home office left")).toBeInTheDocument();
		expect(screen.getByText("Office still required")).toBeInTheDocument();
		expect(screen.getByText("1")).toBeInTheDocument();
		expect(screen.getByText("2")).toBeInTheDocument();
	});

	it("renders fixed office day notes", async () => {
		mockEmployee();
		mocks.usePresenceStatus.mockReturnValue({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: true,
				period: "weekly",
				periodStart: "2026-05-04T00:00:00.000Z",
				periodEnd: "2026-05-10T23:59:59.999Z",
				mode: "fixed_days",
				homeOfficeDaysLeft: 3,
				officeDaysRequiredLeft: 1,
				officeDaysCompleted: 1,
				homeOfficeDaysUsed: 0,
				workingDaysRemaining: 4,
				requiredOfficeDays: 2,
				fixedOfficeDays: ["monday", "wednesday"],
				message: null,
			},
		});

		render(<PresenceStatusWidget />);

		expect(await screen.findByText("Fixed office days: Mon, Wed")).toBeInTheDocument();
	});

	it("hides when presence is disabled", async () => {
		mockEmployee();
		mocks.usePresenceStatus.mockReturnValue({
			isLoading: false,
			data: { presenceEnabled: false },
		});

		const { container } = render(<PresenceStatusWidget />);

		await waitFor(() => expect(container).toBeEmptyDOMElement());
	});

	it("shows an unavailable state for enabled malformed policies", async () => {
		mockEmployee();
		mocks.usePresenceStatus.mockReturnValue({
			isLoading: false,
			data: {
				presenceEnabled: true,
				available: false,
				message: "Presence policy has invalid fixed office days.",
			},
		});

		render(<PresenceStatusWidget />);

		expect(await screen.findByText("Presence policy has invalid fixed office days.")).toBeInTheDocument();
		expect(screen.queryByText("Home office left")).toBeNull();
	});
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
pnpm test -- apps/webapp/src/components/dashboard/presence-status-widget.test.tsx
```

Expected: FAIL because the widget still renders the old `actual/required` progress UI.

- [ ] **Step 3: Replace the widget UI**

In `presence-status-widget.tsx`:

- Keep the current employee lookup.
- Remove `Progress` import and usage.
- Use `IconHome` and `IconBuilding` from `@tabler/icons-react` with the existing `IconMapPin` if desired.
- Add local helpers:

```ts
const DAY_LABELS = {
	monday: "Mon",
	tuesday: "Tue",
	wednesday: "Wed",
	thursday: "Thu",
	friday: "Fri",
	saturday: "Sat",
	sunday: "Sun",
} as const;

function StatPanel({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg border bg-muted/30 p-3">
			<p className="text-2xl font-semibold tabular-nums">{value}</p>
			<p className="text-xs text-muted-foreground">{label}</p>
		</div>
	);
}
```

Render the card body as:

```tsx
{status?.available ? (
	<div className="space-y-3">
		<div className="grid grid-cols-2 gap-2">
			<StatPanel label={t("dashboard.presence.homeOfficeLeft", "Home office left")} value={status.homeOfficeDaysLeft} />
			<StatPanel label={t("dashboard.presence.officeRequiredLeft", "Office still required")} value={status.officeDaysRequiredLeft} />
		</div>
		<p className="text-xs text-muted-foreground">
			{status.mode === "fixed_days" && status.fixedOfficeDays.length > 0
				? t("dashboard.presence.fixedOfficeDays", "Fixed office days: {days}", {
						days: status.fixedOfficeDays.map((day) => DAY_LABELS[day]).join(", "),
					})
				: t("dashboard.presence.flexibleOfficeDays", "Flexible office policy for this period")}
		</p>
		{status.officeDaysRequiredLeft > status.workingDaysRemaining && (
			<p className="text-xs text-amber-600 dark:text-amber-400">
				{t("dashboard.presence.cannotMeetRequirement", "Office requirement can no longer be met in this period.")}
			</p>
		)}
	</div>
) : (
	<p className="text-sm text-muted-foreground">
		{status?.message ?? t("dashboard.presence.unavailable", "Presence policy is unavailable.")}
	</p>
)}
```

Set the `WidgetCard` title and description to:

```tsx
title={t("dashboard.presence.workLocation", "Work location")}
description={t("dashboard.presence.periodDescription", "This period")}
```

- [ ] **Step 4: Run the component test**

Run:

```bash
pnpm test -- apps/webapp/src/components/dashboard/presence-status-widget.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the widget redesign**

Run:

```bash
git add "apps/webapp/src/components/dashboard/presence-status-widget.tsx" "apps/webapp/src/components/dashboard/presence-status-widget.test.tsx"
git commit -m "feat: redesign presence widget for home office"
```

## Task 5: Full Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test -- apps/webapp/src/app/[locale]/(app)/time-tracking/actions/presence-status.test.ts apps/webapp/src/lib/query/use-time-clock.presence.test.tsx apps/webapp/src/components/dashboard/presence-status-widget.test.tsx
```

Expected: PASS for all focused tests.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS, or fail only on known unrelated tests after confirming the focused tests pass.

- [ ] **Step 3: Run production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS, or fail only on pre-existing unrelated issues after confirming no errors reference changed files.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
git diff
```

Expected: Only intended presence widget, presence helper, time clock invalidation, tests, and this plan file are changed.

- [ ] **Step 5: Commit the implementation plan if it is still uncommitted**

Run:

```bash
git add "docs/superpowers/plans/2026-05-21-presence-widget-home-office.md"
git commit -m "docs: plan presence widget home office implementation"
```

Expected: The plan file is committed separately from implementation code if it was not already committed.

## Self-Review Notes

- Spec coverage: The plan covers the two equal stats, effective policy-derived server contract, flexible and fixed modes, weekly/biweekly/monthly period helpers, disabled and malformed states, query freshness after clock changes, and focused tests.
- Placeholder scan: The plan has no deferred implementation markers and every code-changing step includes concrete code or exact replacement guidance.
- Type consistency: `PresenceStatusSummary`, `PresenceEvaluationPeriod`, `PresenceDayOfWeek`, and field names match between helper, server action, hook, and widget tasks.
