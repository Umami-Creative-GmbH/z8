# Calendar Assigned Holidays Work Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display employee-assigned holidays on `/calendar` and set policy-required minutes to `0` on assigned holiday dates.

**Architecture:** Add one focused employee-assigned holiday service in `apps/webapp/src/lib/calendar`, then call it from both `/api/calendar/events` and `getDailyWorkRequirementsForEmployee`. This keeps the work-balance worker correct automatically because it already uses the shared requirement function.

**Tech Stack:** Next.js route handlers, Drizzle ORM, Luxon, Vitest, pnpm.

---

## File Structure

- Create `apps/webapp/src/lib/calendar/assigned-holidays.ts`: employee-scoped assigned holiday resolver, event conversion, holiday date expansion, and pure requirement adjustment helper.
- Create `apps/webapp/src/lib/calendar/assigned-holidays.test.ts`: pure helper tests for date expansion and requirement zeroing.
- Modify `apps/webapp/src/app/api/calendar/events/route.ts`: use assigned holidays when an authorized employee is scoped; keep org-wide fallback when no employee is scoped.
- Modify `apps/webapp/src/app/api/calendar/events/route.test.ts`: mock and assert employee-scoped holiday loading.
- Modify `apps/webapp/src/lib/calendar/work-policy-requirements.ts`: fetch assigned holidays after absence adjustment and zero required minutes.
- Modify `apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`: add source-level guard that requirement calculation calls the holiday adjuster after absence adjustment.

## Task 1: Shared Assigned Holiday Service

**Files:**
- Create: `apps/webapp/src/lib/calendar/assigned-holidays.ts`
- Create: `apps/webapp/src/lib/calendar/assigned-holidays.test.ts`

- [ ] **Step 1: Write failing pure helper tests**

Create `apps/webapp/src/lib/calendar/assigned-holidays.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
	applyAssignedHolidayAdjustmentsToRequirements,
	getAssignedHolidayDateKeys,
	type AssignedHolidayRange,
} from "./assigned-holidays";

const singleDayHoliday: AssignedHolidayRange = {
	id: "holiday-1",
	name: "Labor Day",
	startDate: new Date("2026-05-01T00:00:00.000Z"),
	endDate: new Date("2026-05-01T23:59:59.999Z"),
};

describe("assigned holiday requirement adjustments", () => {
	it("sets required minutes to zero on an assigned holiday", () => {
		expect(
			applyAssignedHolidayAdjustmentsToRequirements(
				{
					"2026-05-01": {
						requiredMinutes: 480,
						policyId: "policy-1",
						policyName: "Standard Hours",
					},
				},
				[singleDayHoliday],
			),
		).toEqual({
			"2026-05-01": {
				requiredMinutes: 0,
				policyId: "policy-1",
				policyName: "Standard Hours",
			},
		});
	});

	it("zeros every overlapping required date for a multi-day holiday", () => {
		const adjusted = applyAssignedHolidayAdjustmentsToRequirements(
			{
				"2026-05-04": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard Hours" },
				"2026-05-05": { requiredMinutes: 360, policyId: "policy-1", policyName: "Standard Hours" },
				"2026-05-06": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard Hours" },
			},
			[
				{
					id: "holiday-2",
					name: "Company Shutdown",
					startDate: new Date("2026-05-04T00:00:00.000Z"),
					endDate: new Date("2026-05-05T23:59:59.999Z"),
				},
			],
		);

		expect(adjusted["2026-05-04"]?.requiredMinutes).toBe(0);
		expect(adjusted["2026-05-05"]?.requiredMinutes).toBe(0);
		expect(adjusted["2026-05-06"]?.requiredMinutes).toBe(480);
	});

	it("does not create requirement entries for holiday dates without policy requirements", () => {
		expect(applyAssignedHolidayAdjustmentsToRequirements({}, [singleDayHoliday])).toEqual({});
	});

	it("expands assigned holiday ranges into UTC date keys", () => {
		expect(
			getAssignedHolidayDateKeys([
				{
					id: "holiday-3",
					name: "Two Day Holiday",
					startDate: new Date("2026-12-24T00:00:00.000Z"),
					endDate: new Date("2026-12-25T23:59:59.999Z"),
				},
			]),
		).toEqual(new Set(["2026-12-24", "2026-12-25"]));
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/calendar/assigned-holidays.test.ts`

Expected: FAIL because `./assigned-holidays` does not exist.

- [ ] **Step 3: Create the service with pure helpers and DB resolver**

Create `apps/webapp/src/lib/calendar/assigned-holidays.ts` with:

```ts
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	employee,
	holidayAssignment,
	holidayPresetAssignment,
	type holiday,
	type holidayPreset,
	type holidayPresetHoliday,
} from "@/db/schema";
import type { DailyWorkRequirements, HolidayEvent } from "./types";

export interface AssignedHolidayRange {
	id: string;
	name: string;
	startDate: Date;
	endDate: Date;
	categoryId?: string | null;
	color?: string | null;
	description?: string | null;
	metadata?: HolidayEvent["metadata"];
}

type HolidayAssignmentWithHoliday = {
	holiday: Pick<
		typeof holiday.$inferSelect,
		"id" | "name" | "organizationId" | "startDate" | "endDate" | "categoryId" | "isActive" | "description"
	> | null;
};

type HolidayPresetAssignmentWithPreset = Pick<typeof holidayPresetAssignment.$inferSelect, "assignmentType"> & {
	preset:
		| (Pick<typeof holidayPreset.$inferSelect, "id" | "name" | "organizationId" | "isActive" | "color"> & {
				holidays: (typeof holidayPresetHoliday.$inferSelect)[];
		  })
		| null;
};

function dateKey(date: DateTime): string | null {
	return date.isValid ? date.toISODate() : null;
}

function expandPresetHoliday(input: {
	presetId: string;
	presetName: string;
	presetColor: string | null;
	presetSource: string;
	holiday: typeof holidayPresetHoliday.$inferSelect;
	year: number;
}): AssignedHolidayRange[] {
	const start = DateTime.utc(input.year, input.holiday.month, input.holiday.day).startOf("day");
	if (!start.isValid) return [];

	const durationDays = Math.max(input.holiday.durationDays || 1, 1);
	const end = start.plus({ days: durationDays - 1 }).endOf("day");

	return [
		{
			id: `preset-${input.presetId}-${input.holiday.id}-${input.year}`,
			name: input.holiday.name,
			startDate: start.toJSDate(),
			endDate: end.toJSDate(),
			categoryId: input.holiday.categoryId,
			color: input.presetColor,
			description: input.holiday.description,
			metadata: {
				categoryName: "Holiday",
				categoryType: input.holiday.holidayType || "public_holiday",
				blocksTimeEntry: true,
				isRecurring: true,
				presetId: input.presetId,
				presetName: input.presetName,
				presetSource: input.presetSource,
			},
		},
	];
}

export function getAssignedHolidayDateKeys(holidays: AssignedHolidayRange[]): Set<string> {
	const keys = new Set<string>();

	for (const holiday of holidays) {
		let cursor = DateTime.fromJSDate(holiday.startDate, { zone: "utc" }).startOf("day");
		const end = DateTime.fromJSDate(holiday.endDate, { zone: "utc" }).startOf("day");
		if (!cursor.isValid || !end.isValid || end < cursor) continue;

		while (cursor <= end) {
			const key = dateKey(cursor);
			if (key) keys.add(key);
			cursor = cursor.plus({ days: 1 });
		}
	}

	return keys;
}

export function applyAssignedHolidayAdjustmentsToRequirements(
	requirements: DailyWorkRequirements,
	holidays: AssignedHolidayRange[],
): DailyWorkRequirements {
	const holidayDateKeys = getAssignedHolidayDateKeys(holidays);
	const adjusted: DailyWorkRequirements = {};

	for (const [key, requirement] of Object.entries(requirements)) {
		adjusted[key] = holidayDateKeys.has(key)
			? { ...requirement, requiredMinutes: 0 }
			: { ...requirement };
	}

	return adjusted;
}

export function assignedHolidayToCalendarEvent(holiday: AssignedHolidayRange): HolidayEvent {
	return {
		id: holiday.id,
		type: "holiday",
		date: holiday.startDate,
		endDate: holiday.endDate,
		title: holiday.name,
		description: holiday.description || undefined,
		color: holiday.color || "#f59e0b",
		metadata: holiday.metadata ?? {
			categoryName: "Holiday",
			categoryType: "public_holiday",
			blocksTimeEntry: true,
			isRecurring: false,
		},
	};
}

export async function getAssignedHolidaysForEmployee(input: {
	organizationId: string;
	employeeId: string;
	startDate: Date;
	endDate: Date;
}): Promise<AssignedHolidayRange[]> {
	const emp = await db.query.employee.findFirst({
		where: and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		columns: { id: true, organizationId: true, teamId: true },
	});

	if (!emp) return [];

	const customAssignmentScope = [eq(holidayAssignment.assignmentType, "organization")];
	if (emp.teamId) customAssignmentScope.push(eq(holidayAssignment.teamId, emp.teamId));
	customAssignmentScope.push(eq(holidayAssignment.employeeId, input.employeeId));

	const presetAssignmentScope = [eq(holidayPresetAssignment.assignmentType, "organization")];
	if (emp.teamId) presetAssignmentScope.push(eq(holidayPresetAssignment.teamId, emp.teamId));
	presetAssignmentScope.push(eq(holidayPresetAssignment.employeeId, input.employeeId));

	const [customAssignments, presetAssignments] = await Promise.all([
		db.query.holidayAssignment.findMany({
			where: and(
				eq(holidayAssignment.organizationId, input.organizationId),
				eq(holidayAssignment.isActive, true),
				or(...customAssignmentScope),
			),
			with: { holiday: true },
		}),
		db.query.holidayPresetAssignment.findMany({
			where: and(
				eq(holidayPresetAssignment.organizationId, input.organizationId),
				eq(holidayPresetAssignment.isActive, true),
				or(...presetAssignmentScope),
				or(isNull(holidayPresetAssignment.effectiveFrom), lte(holidayPresetAssignment.effectiveFrom, input.endDate)),
				or(isNull(holidayPresetAssignment.effectiveUntil), gte(holidayPresetAssignment.effectiveUntil, input.startDate)),
			),
			with: { preset: { with: { holidays: true } } },
		}),
	]);

	const holidaysById = new Map<string, AssignedHolidayRange>();
	const typedCustomAssignments = customAssignments as unknown as HolidayAssignmentWithHoliday[];
	const typedPresetAssignments = presetAssignments as unknown as HolidayPresetAssignmentWithPreset[];

	for (const assignment of typedCustomAssignments) {
		const assignedHoliday = assignment.holiday;
		if (
			!assignedHoliday?.isActive ||
			assignedHoliday.organizationId !== input.organizationId ||
			assignedHoliday.startDate > input.endDate ||
			assignedHoliday.endDate < input.startDate
		) {
			continue;
		}

		holidaysById.set(`custom-${assignedHoliday.id}`, {
			id: assignedHoliday.id,
			name: assignedHoliday.name,
			startDate: assignedHoliday.startDate,
			endDate: assignedHoliday.endDate,
			categoryId: assignedHoliday.categoryId,
			description: assignedHoliday.description,
		});
	}

	const startYear = DateTime.fromJSDate(input.startDate, { zone: "utc" }).year;
	const endYear = DateTime.fromJSDate(input.endDate, { zone: "utc" }).year;
	for (const assignment of typedPresetAssignments) {
		if (!assignment.preset?.isActive || assignment.preset.organizationId !== input.organizationId) continue;

		for (let year = startYear; year <= endYear; year++) {
			for (const presetHoliday of assignment.preset.holidays) {
				if (!presetHoliday.isActive) continue;
				for (const expandedHoliday of expandPresetHoliday({
					presetId: assignment.preset.id,
					presetName: assignment.preset.name,
					presetColor: assignment.preset.color,
					presetSource: assignment.assignmentType,
					holiday: presetHoliday,
					year,
				})) {
					if (expandedHoliday.startDate > input.endDate || expandedHoliday.endDate < input.startDate) continue;
					holidaysById.set(expandedHoliday.id, expandedHoliday);
				}
			}
		}
	}

	return [...holidaysById.values()].sort(
		(left, right) => left.startDate.getTime() - right.startDate.getTime(),
	);
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `pnpm --filter webapp test -- src/lib/calendar/assigned-holidays.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit shared service**

Run:

```bash
git add apps/webapp/src/lib/calendar/assigned-holidays.ts apps/webapp/src/lib/calendar/assigned-holidays.test.ts
git commit -m "feat: add assigned holiday calendar service"
```

Expected: commit succeeds with only the two assigned-holiday files staged.

## Task 2: Calendar API Uses Employee-Assigned Holidays

**Files:**
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`
- Modify: `apps/webapp/src/app/api/calendar/events/route.test.ts`

- [ ] **Step 1: Add failing route test mocks and assertions**

In `apps/webapp/src/app/api/calendar/events/route.test.ts`, add `getAssignedHolidaysForEmployee` and `assignedHolidayToCalendarEvent` to `mockState`:

```ts
getAssignedHolidaysForEmployee: vi.fn(async () => []),
assignedHolidayToCalendarEvent: vi.fn((holiday: { id: string; name: string; startDate: Date; endDate: Date }) => ({
	id: holiday.id,
	type: "holiday" as const,
	date: holiday.startDate,
	endDate: holiday.endDate,
	title: holiday.name,
	color: "#f59e0b",
	metadata: {
		categoryName: "Holiday",
		categoryType: "public_holiday",
		blocksTimeEntry: true,
		isRecurring: false,
	},
})),
```

Add this mock below the existing holiday-service mock:

```ts
vi.mock("@/lib/calendar/assigned-holidays", () => ({
	getAssignedHolidaysForEmployee: mockState.getAssignedHolidaysForEmployee,
	assignedHolidayToCalendarEvent: mockState.assignedHolidayToCalendarEvent,
}));
```

Add this test before the unauthorized requested employee test:

```ts
it("returns employee-assigned holidays for a scoped employee calendar", async () => {
	mockState.getAssignedHolidaysForEmployee.mockResolvedValueOnce([
		{
			id: "holiday-1",
			name: "Labor Day",
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-01T23:59:59.999Z"),
		},
	]);

	const response = await GET(
		createRequest(
			"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showHolidays=true&showWorkPeriods=true",
		),
	);
	const body = getResponsePayload(await response.json());

	expect(response.status).toBe(200);
	expect(mockState.getAssignedHolidaysForEmployee).toHaveBeenCalledWith({
		organizationId: "org-1",
		employeeId: "employee-1",
		startDate: new Date("2026-05-01T00:00:00.000Z"),
		endDate: new Date("2026-05-31T23:59:59.999Z"),
	});
	expect(mockState.getHolidaysForMonth).not.toHaveBeenCalled();
	expect(body.events).toEqual([
		expect.objectContaining({ id: "holiday-1", type: "holiday", title: "Labor Day" }),
	]);
});
```

Extend the unauthorized test with:

```ts
expect(mockState.getAssignedHolidaysForEmployee).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run route test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/api/calendar/events/route.test.ts`

Expected: FAIL because the route still calls `getHolidaysForMonth` for scoped employees.

- [ ] **Step 3: Modify route holiday loading**

In `apps/webapp/src/app/api/calendar/events/route.ts`, add this import:

```ts
import {
	assignedHolidayToCalendarEvent,
	getAssignedHolidaysForEmployee,
} from "@/lib/calendar/assigned-holidays";
```

Add this helper near `fetchMonthEvents`:

```ts
async function fetchHolidayEvents(params: {
	organizationId: string;
	employeeId: string | undefined;
	month: number;
	year: number;
	showHolidays: boolean;
}): Promise<CalendarEvent[]> {
	if (!params.showHolidays) return [];

	if (!params.employeeId) {
		return getHolidaysForMonth(params.organizationId, params.month, params.year);
	}

	const start = DateTime.utc(params.year, params.month + 1, 1).startOf("day");
	const end = start.endOf("month");
	try {
		const assignedHolidays = await getAssignedHolidaysForEmployee({
			organizationId: params.organizationId,
			employeeId: params.employeeId,
			startDate: start.toJSDate(),
			endDate: end.toJSDate(),
		});
		return assignedHolidays.map(assignedHolidayToCalendarEvent);
	} catch (error) {
		console.error("Error fetching assigned calendar holidays:", error);
		return [];
	}
}
```

Replace the `holidays` entry inside `fetchMonthEvents` with:

```ts
fetchHolidayEvents({ organizationId, employeeId, month, year, showHolidays }),
```

- [ ] **Step 4: Run route test to verify it passes**

Run: `pnpm --filter webapp test -- src/app/api/calendar/events/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit calendar API integration**

Run:

```bash
git add apps/webapp/src/app/api/calendar/events/route.ts apps/webapp/src/app/api/calendar/events/route.test.ts
git commit -m "feat: show assigned holidays on calendar"
```

Expected: commit succeeds with only route files staged.

## Task 3: Work Requirements Zero Assigned Holidays

**Files:**
- Modify: `apps/webapp/src/lib/calendar/work-policy-requirements.ts`
- Modify: `apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`

- [ ] **Step 1: Add failing source-level requirement test**

In `apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`, add these expectations to the existing `describe("getDailyWorkRequirementsForEmployee", ...)` block:

```ts
it("applies assigned holiday adjustments after absence adjustments", () => {
	expect(source).toContain("getAssignedHolidaysForEmployee");
	expect(source).toContain("applyAssignedHolidayAdjustmentsToRequirements");
	expect(source).toContain("const absenceAdjustedRequirements = applyApprovedAbsencesToDailyRequirements");
	expect(source).toContain("return applyAssignedHolidayAdjustmentsToRequirements(absenceAdjustedRequirements, assignedHolidays)");
});
```

- [ ] **Step 2: Run requirement test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/calendar/work-policy-requirements.test.ts`

Expected: FAIL because `work-policy-requirements.ts` has no assigned holiday imports or adjustment call.

- [ ] **Step 3: Add holiday adjustment to requirement calculation**

In `apps/webapp/src/lib/calendar/work-policy-requirements.ts`, add this import:

```ts
import {
	applyAssignedHolidayAdjustmentsToRequirements,
	getAssignedHolidaysForEmployee,
} from "./assigned-holidays";
```

Replace the final return in `getDailyWorkRequirementsForEmployee` with this block:

```ts
const absenceAdjustedRequirements = applyApprovedAbsencesToDailyRequirements(
	requirements,
	approvedAbsences,
);
const assignedHolidays = yield* _(
	Effect.promise(() =>
		getAssignedHolidaysForEmployee({
			organizationId: params.organizationId,
			employeeId: params.employeeId,
			startDate: effectiveStartDate,
			endDate: params.endDate,
		}),
	),
);

return applyAssignedHolidayAdjustmentsToRequirements(absenceAdjustedRequirements, assignedHolidays);
```

- [ ] **Step 4: Run requirement and helper tests**

Run: `pnpm --filter webapp test -- src/lib/calendar/work-policy-requirements.test.ts src/lib/calendar/assigned-holidays.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit requirement integration**

Run:

```bash
git add apps/webapp/src/lib/calendar/work-policy-requirements.ts apps/webapp/src/lib/calendar/work-policy-requirements.test.ts
git commit -m "feat: zero work targets on assigned holidays"
```

Expected: commit succeeds with only requirement files staged.

## Task 4: Final Verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
pnpm --filter webapp test -- src/lib/calendar/assigned-holidays.test.ts src/lib/calendar/work-policy-requirements.test.ts src/app/api/calendar/events/route.test.ts src/lib/work-balance/service.test.ts
```

Expected: PASS. This verifies the new helper, requirement integration, route behavior, and the worker-facing balance aggregation tests.

- [ ] **Step 2: Inspect changed files**

Run: `git status --short`

Expected: clean working tree if each task committed, or only intentional uncommitted files if execution skipped commits.

- [ ] **Step 3: Inspect recent commits**

Run: `git log --oneline -5`

Expected: recent commits include the design spec commit and the three feature commits from Tasks 1 through 3.

- [ ] **Step 4: Report verification outcome**

Final response should state:

```text
Implemented employee-assigned calendar holidays and holiday-zeroed work targets. Targeted tests passed: assigned-holidays, work-policy-requirements, calendar events route, and work-balance service.
```

If any targeted command fails because of unrelated existing issues, include the failing command, the relevant error summary, and which narrower checks passed.
