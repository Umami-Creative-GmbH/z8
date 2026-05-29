# Calendar Running Work Period Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the currently active clock-in as a running work block in `/calendar` day and week views, ending at the current time.

**Architecture:** Extend the existing calendar work-period service to include active work periods as display events while preserving completed-only actual-minute calculations. Filter running events out of non-timed Schedule-X views at the component boundary.

**Tech Stack:** Next.js route handlers, Drizzle ORM, Luxon, React, Schedule-X, Vitest, Testing Library.

---

## File Structure

- Modify `apps/webapp/src/lib/calendar/types.ts` to add `metadata.isRunning?: true` to `WorkPeriodEvent`.
- Modify `apps/webapp/src/lib/calendar/work-period-service.ts` to return completed and active work period events, with active events using `endDate = now`.
- Create `apps/webapp/src/lib/calendar/work-period-service.test.ts` for service-level tests around active period event shaping.
- Modify `apps/webapp/src/app/api/calendar/events/route.ts` to exclude running periods from daily actual-minute summaries.
- Modify `apps/webapp/src/app/api/calendar/events/route.test.ts` to prove hidden work-period summaries exclude running periods.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx` to filter running events to day/week only.
- Create `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx` for view-mode filtering behavior.

## Task 1: Type And Service Event Shape

**Files:**
- Modify: `apps/webapp/src/lib/calendar/types.ts`
- Modify: `apps/webapp/src/lib/calendar/work-period-service.ts`
- Create: `apps/webapp/src/lib/calendar/work-period-service.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `apps/webapp/src/lib/calendar/work-period-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	dbSelect: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: mockState.dbSelect,
	},
}));

vi.mock("@/db/auth-schema", () => ({
	user: { id: "user.id", name: "user.name" },
}));

vi.mock("@/db/schema", () => ({
	employee: { id: "employee.id", userId: "employee.userId" },
	project: { id: "project.id" },
	surchargeCalculation: { workPeriodId: "surcharge.workPeriodId" },
	timeEntry: { id: "timeEntry.id" },
	workPeriod: {
		id: "workPeriod.id",
		organizationId: "workPeriod.organizationId",
		employeeId: "workPeriod.employeeId",
		startTime: "workPeriod.startTime",
		endTime: "workPeriod.endTime",
		clockOutId: "workPeriod.clockOutId",
		projectId: "workPeriod.projectId",
	},
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
	gte: vi.fn((left: unknown, right: unknown) => ({ type: "gte", left, right })),
	isNull: vi.fn((value: unknown) => ({ type: "isNull", value })),
	lte: vi.fn((left: unknown, right: unknown) => ({ type: "lte", left, right })),
	or: vi.fn((...conditions: unknown[]) => ({ type: "or", conditions })),
}));

const { getWorkPeriodsForMonth } = await import("./work-period-service");

function mockQueryRows(rows: unknown[]) {
	const where = vi.fn(async () => rows);
	const leftJoinProject = vi.fn(() => ({ where }));
	const leftJoinSurcharge = vi.fn(() => ({ leftJoin: leftJoinProject }));
	const leftJoinTimeEntry = vi.fn(() => ({ leftJoin: leftJoinSurcharge }));
	const innerJoinUser = vi.fn(() => ({ leftJoin: leftJoinTimeEntry }));
	const innerJoinEmployee = vi.fn(() => ({ innerJoin: innerJoinUser }));
	const from = vi.fn(() => ({ innerJoin: innerJoinEmployee }));
	mockState.dbSelect.mockReturnValue({ from });
	return { where };
}

describe("getWorkPeriodsForMonth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:30:00.000Z"));
	});

	it("returns active work periods as running calendar events ending at the current time", async () => {
		mockQueryRows([
			{
				period: {
					id: "active-period-1",
					employeeId: "employee-1",
					organizationId: "org-1",
					startTime: new Date("2026-05-04T08:00:00.000Z"),
					endTime: null,
					durationMinutes: null,
					approvalStatus: "approved",
				},
				user: { name: "Ada Lovelace" },
				clockOutEntry: null,
				surcharge: null,
				project: { id: "project-1", name: "Payroll", color: "#2563eb" },
			},
		]);

		const events = await getWorkPeriodsForMonth(4, 2026, {
			organizationId: "org-1",
			employeeId: "employee-1",
		});

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			id: "active-period-1",
			type: "work_period",
			date: new Date("2026-05-04T08:00:00.000Z"),
			endDate: new Date("2026-05-04T10:30:00.000Z"),
			title: "[Payroll] Ada Lovelace - 2h 30m (running)",
			description: "Running work period",
			color: "#2563eb",
			metadata: {
				durationMinutes: 150,
				employeeName: "Ada Lovelace",
				isRunning: true,
				projectId: "project-1",
				projectName: "Payroll",
				projectColor: "#2563eb",
				approvalStatus: "approved",
			},
		});
		expect(events[0].metadata.endTime).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the service test to verify it fails**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/calendar/work-period-service.test.ts
```

Expected: FAIL because active work periods are not included and `metadata.isRunning` is not typed.

- [ ] **Step 3: Add the running metadata type**

In `apps/webapp/src/lib/calendar/types.ts`, update `WorkPeriodEvent.metadata`:

```ts
export interface WorkPeriodEvent extends CalendarEvent {
	type: "work_period";
	metadata: {
		durationMinutes: number;
		employeeName: string;
		notes?: string;
		periodCount?: number;
		isRunning?: true;
		// Time fields - formatted time strings (e.g., "2:30 PM")
		startTime?: string;
		endTime?: string;
		// Project fields - optional, only present if work period is assigned to a project
		projectId?: string;
		projectName?: string;
		projectColor?: string;
		// Surcharge fields - optional, only present if surcharges are enabled
		surchargeMinutes?: number;
		totalCreditedMinutes?: number;
		surchargeBreakdown?: SurchargeBreakdown[];
		// Approval status - for change policy enforcement
		// "approved" = normal working period (default)
		// "pending" = awaiting manager approval
		// "rejected" = manager rejected the change
		approvalStatus?: "approved" | "pending" | "rejected";
	};
}
```

- [ ] **Step 4: Include active work periods in the service query**

In `apps/webapp/src/lib/calendar/work-period-service.ts`, change the import and completed-only condition:

```ts
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
```

Replace the `conditions` end-time filter with:

```ts
		const now = new Date();
		const conditions = [
			// Direct organization filter (no join needed for org filtering)
			eq(workPeriod.organizationId, filters.organizationId),
			// Date range filter
			gte(workPeriod.startTime, startDate),
			lte(workPeriod.startTime, endDate),
			// Include completed periods and the currently active period.
			or(lte(workPeriod.endTime, now), isNull(workPeriod.endTime)),
		];
```

Then replace the mapping section from `const notes = ...` through the returned object with this code:

```ts
		return periods.map(({ period, user, clockOutEntry, surcharge, project: proj }) => {
			const notes = clockOutEntry?.notes?.trim();
			const isRunning = !period.endTime;
			const runningEndTime = now;
			const startDT = dateFromDB(period.startTime);
			const endDT = period.endTime ? dateFromDB(period.endTime) : dateFromDB(runningEndTime);
			const durationMinutes = isRunning
				? Math.max(0, Math.floor((runningEndTime.getTime() - period.startTime.getTime()) / 60000))
				: (period.durationMinutes ?? 0);
			const surchargeMinutes = isRunning ? 0 : (surcharge?.surchargeMinutes ?? 0);
			const totalCreditedMinutes = durationMinutes + surchargeMinutes;

			// Format duration, including surcharge if present
			const baseDuration = formatDuration(durationMinutes);
			const duration = isRunning
				? `${baseDuration} (running)`
				: surchargeMinutes > 0
					? `${baseDuration} (+${formatDuration(surchargeMinutes)})`
					: baseDuration;

			// Build title parts
			const projectPrefix = proj?.name ? `[${proj.name}] ` : "";
			const title = notes
				? `${projectPrefix}${user.name} - ${duration}: ${notes}`
				: `${projectPrefix}${user.name} - ${duration}`;

			// Parse surcharge breakdown from calculation details
			let surchargeBreakdown: SurchargeBreakdown[] | undefined;
			if (!isRunning && surcharge?.calculationDetails) {
				const details = surcharge.calculationDetails as SurchargeCalculationDetails;
				if (details.rulesApplied && details.rulesApplied.length > 0) {
					surchargeBreakdown = details.rulesApplied.map((rule) => ({
						ruleName: rule.ruleName,
						ruleType: rule.ruleType as SurchargeBreakdown["ruleType"],
						percentage: rule.percentage,
						qualifyingMinutes: rule.qualifyingMinutes,
						surchargeMinutes: rule.surchargeMinutes,
					}));
				}
			}

			// Use project color if available, otherwise default green
			const eventColor = proj?.color || "#10b981"; // Green (emerald)

			// Format start and end times for display
			const startTimeFormatted = startDT?.toLocaleString(DateTime.TIME_SIMPLE) ?? undefined;
			const endTimeFormatted = isRunning
				? undefined
				: (endDT?.toLocaleString(DateTime.TIME_SIMPLE) ?? undefined);

			return {
				id: period.id,
				type: "work_period" as const,
				date: period.startTime,
				endDate: period.endTime ?? runningEndTime,
				title,
				description: isRunning ? "Running work period" : notes || "Work period",
				descriptionKey: isRunning
					? "calendar.calendar.workPeriod.runningDescription"
					: notes
						? undefined
						: "calendar.calendar.workPeriod.fallbackDescription",
				color: eventColor,
				metadata: {
					durationMinutes,
					employeeName: user.name,
					notes: notes || undefined,
					...(isRunning && { isRunning: true as const }),
					startTime: startTimeFormatted,
					endTime: endTimeFormatted,
					...(proj && {
						projectId: proj.id,
						projectName: proj.name,
						projectColor: proj.color || undefined,
					}),
					...(!isRunning &&
						surcharge && {
							surchargeMinutes,
							totalCreditedMinutes,
							surchargeBreakdown,
						}),
					approvalStatus: period.approvalStatus ?? "approved",
				},
			};
		});
```

- [ ] **Step 5: Run the service test to verify it passes**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/calendar/work-period-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Only commit if the user explicitly requested commits for this session. If commits are allowed, run:

```bash
git add apps/webapp/src/lib/calendar/types.ts apps/webapp/src/lib/calendar/work-period-service.ts apps/webapp/src/lib/calendar/work-period-service.test.ts
git commit -m "feat: expose running work periods in calendar service"
```

## Task 2: Exclude Running Periods From Actual-Minute Summaries

**Files:**
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`
- Modify: `apps/webapp/src/app/api/calendar/events/route.test.ts`

- [ ] **Step 1: Write the failing route test**

Append this test inside `describe("GET /api/calendar/events", () => { ... })` in `apps/webapp/src/app/api/calendar/events/route.test.ts`:

```ts
	it("excludes running work periods from daily actual minutes", async () => {
		mockState.getWorkPeriodsForMonth.mockResolvedValueOnce([
			{
				id: "completed-period-1",
				type: "work_period",
				date: new Date("2026-05-04T08:00:00.000Z"),
				endDate: new Date("2026-05-04T12:00:00.000Z"),
				title: "Completed work period",
				color: "#10b981",
				metadata: { durationMinutes: 240, employeeName: "Ada" },
			},
			{
				id: "running-period-1",
				type: "work_period",
				date: new Date("2026-05-04T13:00:00.000Z"),
				endDate: new Date("2026-05-04T14:30:00.000Z"),
				title: "Ada - 1h 30m (running)",
				color: "#10b981",
				metadata: { durationMinutes: 90, employeeName: "Ada", isRunning: true },
			},
		]);

		const response = await GET(
			createRequest(
				"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=true",
			),
		);
		const body = getResponsePayload(await response.json());

		expect(response.status).toBe(200);
		expect(body.events).toHaveLength(2);
		expect(body.dailyActualMinutes).toEqual({
			"2026-05-04": 240,
		});
	});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```bash
pnpm --filter @z8/webapp test src/app/api/calendar/events/route.test.ts
```

Expected: FAIL because `dailyActualMinutes` includes 330 minutes instead of 240.

- [ ] **Step 3: Filter actual-minute inputs in the route**

In `apps/webapp/src/app/api/calendar/events/route.ts`, change the return block in `fetchMonthEvents` from:

```ts
	return {
		events: [...holidays, ...absences, ...timeEntries, ...(showWorkPeriods ? workPeriods : [])],
		dailyActualMinutes: includeWorkPeriodActuals ? buildDailyActualMinutes(workPeriods) : {},
	};
```

to:

```ts
	const completedWorkPeriods = workPeriods.filter((event) => !event.metadata.isRunning);

	return {
		events: [...holidays, ...absences, ...timeEntries, ...(showWorkPeriods ? workPeriods : [])],
		dailyActualMinutes: includeWorkPeriodActuals
			? buildDailyActualMinutes(completedWorkPeriods)
			: {},
	};
```

- [ ] **Step 4: Run the route test to verify it passes**

Run:

```bash
pnpm --filter @z8/webapp test src/app/api/calendar/events/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Only commit if the user explicitly requested commits for this session. If commits are allowed, run:

```bash
git add apps/webapp/src/app/api/calendar/events/route.ts apps/webapp/src/app/api/calendar/events/route.test.ts
git commit -m "fix: exclude running periods from calendar actuals"
```

## Task 3: Filter Running Events To Day And Week Views

**Files:**
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Create: `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`

- [ ] **Step 1: Extract the filtering helper and write the failing test**

Create `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import type { WorkPeriodEvent } from "@/lib/calendar/types";
import { filterEventsForScheduleXView } from "./schedule-x-calendar";

const completedEvent: WorkPeriodEvent = {
	id: "completed-period-1",
	type: "work_period",
	date: new Date("2026-05-04T08:00:00.000Z"),
	endDate: new Date("2026-05-04T12:00:00.000Z"),
	title: "Completed work period",
	color: "#10b981",
	metadata: { durationMinutes: 240, employeeName: "Ada" },
};

const runningEvent: WorkPeriodEvent = {
	id: "running-period-1",
	type: "work_period",
	date: new Date("2026-05-04T13:00:00.000Z"),
	endDate: new Date("2026-05-04T14:30:00.000Z"),
	title: "Ada - 1h 30m (running)",
	color: "#10b981",
	metadata: { durationMinutes: 90, employeeName: "Ada", isRunning: true },
};

describe("filterEventsForScheduleXView", () => {
	it("keeps running events in day and week views", () => {
		expect(filterEventsForScheduleXView([completedEvent, runningEvent], "day")).toEqual([
			completedEvent,
			runningEvent,
		]);
		expect(filterEventsForScheduleXView([completedEvent, runningEvent], "week")).toEqual([
			completedEvent,
			runningEvent,
		]);
	});

	it("removes running events from month and year views", () => {
		expect(filterEventsForScheduleXView([completedEvent, runningEvent], "month")).toEqual([
			completedEvent,
		]);
		expect(filterEventsForScheduleXView([completedEvent, runningEvent], "year")).toEqual([
			completedEvent,
		]);
	});
});
```

- [ ] **Step 2: Run the component helper test to verify it fails**

Run:

```bash
pnpm --filter @z8/webapp test src/components/calendar/schedule-x-calendar.test.tsx
```

Expected: FAIL because `filterEventsForScheduleXView` is not exported.

- [ ] **Step 3: Implement the filtering helper**

In `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`, add this helper after `viewModeToScheduleX`:

```ts
export function filterEventsForScheduleXView(
	events: CalendarEvent[],
	viewMode: ViewMode,
): CalendarEvent[] {
	if (viewMode === "day" || viewMode === "week") {
		return events;
	}

	return events.filter((event) => event.type !== "work_period" || !event.metadata.isRunning);
}
```

Then change the Schedule-X event conversion from:

```ts
	const baseScheduleXEvents = calendarEventsToScheduleX(events, timeZone);
```

to:

```ts
	const visibleEvents = filterEventsForScheduleXView(events, viewMode);
	const baseScheduleXEvents = calendarEventsToScheduleX(visibleEvents, timeZone);
```

- [ ] **Step 4: Run the component helper test to verify it passes**

Run:

```bash
pnpm --filter @z8/webapp test src/components/calendar/schedule-x-calendar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Only commit if the user explicitly requested commits for this session. If commits are allowed, run:

```bash
git add apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx
git commit -m "fix: limit running calendar blocks to timed views"
```

## Task 4: Verification

**Files:**
- Verify all changed files from Tasks 1-3.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/calendar/work-period-service.test.ts src/app/api/calendar/events/route.test.ts src/components/calendar/schedule-x-calendar.test.tsx
```

Expected: PASS for all focused tests.

- [ ] **Step 2: Run the existing related calendar tests**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/calendar/schedule-x-adapter.test.ts src/components/calendar/calendar-view.test.tsx
```

Expected: PASS for existing related tests.

- [ ] **Step 3: Run lint or typecheck if available in package scripts**

Run:

```bash
pnpm --filter @z8/webapp lint
```

Expected: PASS. If the package has no `lint` script, record that it was unavailable and run the focused tests from Step 1 again.

- [ ] **Step 4: Review the diff**

Run:

```bash
git diff -- apps/webapp/src/lib/calendar/types.ts apps/webapp/src/lib/calendar/work-period-service.ts apps/webapp/src/lib/calendar/work-period-service.test.ts apps/webapp/src/app/api/calendar/events/route.ts apps/webapp/src/app/api/calendar/events/route.test.ts apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx
```

Expected: Diff only contains the running work-period feature and tests.

- [ ] **Step 5: Final commit**

Only commit if the user explicitly requested commits for this session. If commits are allowed and earlier task commits were skipped, run:

```bash
git add apps/webapp/src/lib/calendar/types.ts apps/webapp/src/lib/calendar/work-period-service.ts apps/webapp/src/lib/calendar/work-period-service.test.ts apps/webapp/src/app/api/calendar/events/route.ts apps/webapp/src/app/api/calendar/events/route.test.ts apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx docs/superpowers/specs/2026-05-29-calendar-running-work-period-design.md docs/superpowers/plans/2026-05-29-calendar-running-work-period.md
git commit -m "feat: show running work periods on calendar"
```

## Self-Review

- Spec coverage: Task 1 covers active event shape, Task 2 covers completed-only summaries, Task 3 covers day/week-only rendering, Task 4 covers verification.
- Placeholder scan: No `TBD`, `TODO`, or undefined implementation references remain.
- Type consistency: The plan uses `metadata.isRunning?: true` consistently across service, route, and component tests.
