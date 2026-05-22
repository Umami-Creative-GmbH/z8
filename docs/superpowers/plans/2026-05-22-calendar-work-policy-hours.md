# Calendar Work Policy Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each selected employee's policy-required hours on `/calendar` and mark each required day as met, over, under, or missing.

**Architecture:** Keep work-policy schedule calculation on the server and return `dailyRequirements` beside existing calendar `events`. Keep client aggregation focused on comparing returned requirements with completed work-period minutes. Render the new status as a small day/week strip and reuse the same summary data for year-view dots.

**Tech Stack:** Next.js route handlers, Drizzle schema/types, Effect work policy service, Luxon date handling, React client components, TanStack Query, Vitest, pnpm.

---

## File Map

- Create `apps/webapp/src/lib/calendar/work-policy-requirements.ts`: pure helpers for deriving per-date required minutes from an `EffectiveWorkPolicy` schedule.
- Create `apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`: unit tests for detailed schedules, simple weekday schedules, missing schedules, and unsupported simple cycles.
- Modify `apps/webapp/src/app/api/calendar/events/route.ts`: return `dailyRequirements` and call the requirement helper after the authorized/scoped employee is known.
- Modify `apps/webapp/src/app/api/calendar/events/route.test.ts`: mock the requirement helper and verify empty/filled requirement response behavior without changing existing auth scoping.
- Modify `apps/webapp/src/lib/calendar/types.ts`: add `DailyWorkRequirement`, `DailyWorkRequirements`, `DailyWorkHoursSummary`, and status types.
- Modify `apps/webapp/src/lib/validations/calendar.ts`: add Zod schemas for `dailyRequirements` response parsing.
- Modify `apps/webapp/src/hooks/use-calendar-data.ts`: parse and return `dailyRequirements` from the API.
- Create `apps/webapp/src/lib/calendar/work-hours-summary.ts`: pure client helper for summing work periods and deriving status/delta.
- Create `apps/webapp/src/lib/calendar/work-hours-summary.test.ts`: unit tests for status derivation and no-fallback behavior.
- Create `apps/webapp/src/components/calendar/daily-requirement-strip.tsx`: compact day/week visual strip for required hours and over/under values.
- Modify `apps/webapp/src/components/calendar/calendar-view.tsx`: build daily summaries from events plus requirements and pass them to child calendar views.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`: render `DailyRequirementStrip` under the existing toolbar for day/week views.
- Modify `apps/webapp/src/components/calendar/year-calendar-view.tsx`: consume policy-derived summaries instead of hardcoded `8h` expected data.

---

### Task 1: Policy Requirement Helper

**Files:**
- Create: `apps/webapp/src/lib/calendar/work-policy-requirements.ts`
- Create: `apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`
- Modify: `apps/webapp/src/lib/calendar/types.ts`

- [ ] **Step 1: Add shared requirement types**

In `apps/webapp/src/lib/calendar/types.ts`, add these exports after `CalendarEvent`:

```ts
export interface DailyWorkRequirement {
	requiredMinutes: number;
	policyId: string;
	policyName: string;
}

export type DailyWorkRequirements = Record<string, DailyWorkRequirement>;

export type DailyWorkHoursStatus = "met" | "over" | "under" | "missing";

export interface DailyWorkHoursSummary extends DailyWorkRequirement {
	actualMinutes: number;
	deltaMinutes: number;
	status: DailyWorkHoursStatus;
}

export type DailyWorkHoursSummaries = Map<string, DailyWorkHoursSummary>;
```

- [ ] **Step 2: Write failing tests for policy requirement calculation**

Create `apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";
import { buildDailyWorkRequirements } from "./work-policy-requirements";

function basePolicy(schedule: EffectiveWorkPolicy["schedule"]): EffectiveWorkPolicy {
	return {
		policyId: "policy-1",
		policyName: "Standard Hours",
		schedule,
		regulation: null,
		assignmentType: "employee",
		assignedVia: "Individual",
	};
}

describe("buildDailyWorkRequirements", () => {
	it("returns no requirements when no schedule is enabled", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy(null),
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-07T23:59:59.999Z"),
		});

		expect(requirements).toEqual({});
	});

	it("splits a weekly simple weekday schedule across Monday through Friday", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "weekly",
				scheduleType: "simple",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
				homeOfficeDaysPerCycle: 0,
				days: [],
			}),
			startDate: new Date("2026-05-04T00:00:00.000Z"),
			endDate: new Date("2026-05-10T23:59:59.999Z"),
		});

		expect(requirements["2026-05-04"]?.requiredMinutes).toBe(480);
		expect(requirements["2026-05-08"]?.requiredMinutes).toBe(480);
		expect(requirements["2026-05-09"]).toBeUndefined();
		expect(requirements["2026-05-10"]).toBeUndefined();
	});

	it("uses detailed per-day hours and omits non-work days", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "weekly",
				scheduleType: "detailed",
				workingDaysPreset: "custom",
				hoursPerCycle: null,
				homeOfficeDaysPerCycle: 0,
				days: [
					{ dayOfWeek: "monday", hoursPerDay: "7.5", isWorkDay: true },
					{ dayOfWeek: "tuesday", hoursPerDay: "8", isWorkDay: true },
					{ dayOfWeek: "wednesday", hoursPerDay: "0", isWorkDay: false },
				],
			}),
			startDate: new Date("2026-05-04T00:00:00.000Z"),
			endDate: new Date("2026-05-06T23:59:59.999Z"),
		});

		expect(requirements["2026-05-04"]?.requiredMinutes).toBe(450);
		expect(requirements["2026-05-05"]?.requiredMinutes).toBe(480);
		expect(requirements["2026-05-06"]).toBeUndefined();
	});

	it("does not guess unsupported non-weekly simple cycle requirements", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "monthly",
				scheduleType: "simple",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "160",
				homeOfficeDaysPerCycle: 0,
				days: [],
			}),
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-31T23:59:59.999Z"),
		});

		expect(requirements).toEqual({});
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`

Expected: FAIL because `./work-policy-requirements` does not exist yet.

- [ ] **Step 4: Implement minimal policy requirement helper**

Create `apps/webapp/src/lib/calendar/work-policy-requirements.ts`:

```ts
import { DateTime } from "luxon";
import type { DailyWorkRequirements } from "./types";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";

const WEEKDAY_BY_NUMBER: Record<number, EffectiveWorkPolicyScheduleDayName> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

type EffectiveWorkPolicyScheduleDayName = NonNullable<
	EffectiveWorkPolicy["schedule"]
>["days"][number]["dayOfWeek"];

const PRESET_DAYS: Record<string, EffectiveWorkPolicyScheduleDayName[]> = {
	weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
	weekends: ["saturday", "sunday"],
	all_days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
};

interface BuildDailyWorkRequirementsOptions {
	policy: EffectiveWorkPolicy | null;
	startDate: Date;
	endDate: Date;
}

function hoursToMinutes(hours: string | null | undefined): number {
	const parsed = Number.parseFloat(hours ?? "");
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.round(parsed * 60);
}

function getSimpleWorkDays(
	schedule: NonNullable<EffectiveWorkPolicy["schedule"]>,
): EffectiveWorkPolicyScheduleDayName[] {
	if (schedule.workingDaysPreset === "custom") {
		return schedule.days.filter((day) => day.isWorkDay).map((day) => day.dayOfWeek);
	}

	return PRESET_DAYS[schedule.workingDaysPreset] ?? [];
}

function getRequiredMinutesForDay(
	policy: EffectiveWorkPolicy,
	dayName: EffectiveWorkPolicyScheduleDayName,
): number {
	const schedule = policy.schedule;
	if (!schedule) return 0;

	if (schedule.scheduleType === "detailed") {
		const configuredDay = schedule.days.find(
			(day) => day.dayOfWeek === dayName && day.isWorkDay,
		);
		return hoursToMinutes(configuredDay?.hoursPerDay);
	}

	if (schedule.scheduleType === "simple") {
		if (schedule.scheduleCycle !== "weekly") return 0;

		const workDays = getSimpleWorkDays(schedule);
		if (!workDays.includes(dayName) || workDays.length === 0) return 0;

		const cycleMinutes = hoursToMinutes(schedule.hoursPerCycle);
		return cycleMinutes > 0 ? Math.round(cycleMinutes / workDays.length) : 0;
	}

	return 0;
}

export function buildDailyWorkRequirements({
	policy,
	startDate,
	endDate,
}: BuildDailyWorkRequirementsOptions): DailyWorkRequirements {
	if (!policy?.schedule) return {};

	const start = DateTime.fromJSDate(startDate).startOf("day");
	const end = DateTime.fromJSDate(endDate).startOf("day");
	if (!start.isValid || !end.isValid || end < start) return {};

	const requirements: DailyWorkRequirements = {};

	for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
		const dayName = WEEKDAY_BY_NUMBER[cursor.weekday];
		const requiredMinutes = getRequiredMinutesForDay(policy, dayName);
		if (requiredMinutes <= 0) continue;

		requirements[cursor.toFormat("yyyy-MM-dd")] = {
			requiredMinutes,
			policyId: policy.policyId,
			policyName: policy.policyName,
		};
	}

	return requirements;
}
```

- [ ] **Step 5: Run helper tests**

Run: `pnpm vitest run apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/webapp/src/lib/calendar/types.ts apps/webapp/src/lib/calendar/work-policy-requirements.ts apps/webapp/src/lib/calendar/work-policy-requirements.test.ts
git commit -m "feat: derive calendar work policy requirements"
```

---

### Task 2: Calendar Events API Response

**Files:**
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`
- Modify: `apps/webapp/src/app/api/calendar/events/route.test.ts`

- [ ] **Step 1: Extend route tests with daily requirements**

Modify the hoisted mock state in `apps/webapp/src/app/api/calendar/events/route.test.ts` to include the requirement helper:

```ts
const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	getVerifiedOrgContext: vi.fn(),
	getAbsencesForMonth: vi.fn(async () => []),
	getHolidaysForMonth: vi.fn(async () => []),
	getTimeEntriesForMonth: vi.fn(async () => []),
	getWorkPeriodsForMonth: vi.fn(async () => []),
	getDailyWorkRequirementsForEmployee: vi.fn(async () => ({})),
}));
```

Add this mock after the work-period-service mock:

```ts
vi.mock("@/lib/calendar/work-policy-requirements", () => ({
	getDailyWorkRequirementsForEmployee: mockState.getDailyWorkRequirementsForEmployee,
}));
```

Add these tests inside `describe("GET /api/calendar/events", () => { ... })`:

```ts
it("returns daily requirements for the scoped employee", async () => {
	mockState.getDailyWorkRequirementsForEmployee.mockResolvedValueOnce({
		"2026-05-04": {
			requiredMinutes: 480,
			policyId: "policy-1",
			policyName: "Standard Hours",
		},
	});

	const response = await GET(
		createRequest(
			"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=true",
		),
	);
	const body = await response.json();

	expect(response.status).toBe(200);
	expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith({
		employeeId: "employee-1",
		startDate: new Date("2026-05-01T00:00:00.000Z"),
		endDate: new Date("2026-05-31T23:59:59.999Z"),
	});
	expect(body.json.dailyRequirements).toEqual({
		"2026-05-04": {
			requiredMinutes: 480,
			policyId: "policy-1",
			policyName: "Standard Hours",
		},
	});
});

it("returns empty daily requirements when policy calculation fails", async () => {
	mockState.getDailyWorkRequirementsForEmployee.mockRejectedValueOnce(new Error("policy failed"));

	const response = await GET(
		createRequest(
			"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showWorkPeriods=true",
		),
	);
	const body = await response.json();

	expect(response.status).toBe(200);
	expect(body.json.dailyRequirements).toEqual({});
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run: `pnpm vitest run apps/webapp/src/app/api/calendar/events/route.test.ts`

Expected: FAIL because the API does not return `dailyRequirements` yet.

- [ ] **Step 3: Add server-side requirement loader**

Extend `apps/webapp/src/lib/calendar/work-policy-requirements.ts` with these imports:

```ts
import { Effect } from "effect";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { WorkPolicyService, WorkPolicyServiceLive } from "@/lib/effect/services/work-policy.service";
```

Add this function at the end of the file:

```ts
export async function getDailyWorkRequirementsForEmployee(params: {
	employeeId: string;
	startDate: Date;
	endDate: Date;
}): Promise<DailyWorkRequirements> {
	return Effect.runPromise(
		Effect.gen(function* (_) {
			const service = yield* _(WorkPolicyService);
			const policy = yield* _(service.getEffectivePolicy(params.employeeId));
			return buildDailyWorkRequirements({
				policy,
				startDate: params.startDate,
				endDate: params.endDate,
			});
		}).pipe(Effect.provide(WorkPolicyServiceLive), Effect.provide(DatabaseServiceLive)),
	);
}
```

- [ ] **Step 4: Update the route to include requirements**

In `apps/webapp/src/app/api/calendar/events/route.ts`, add imports:

```ts
import { DateTime } from "luxon";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import type { DailyWorkRequirements } from "@/lib/calendar/types";
```

Add this helper near `fetchMonthEvents`:

```ts
function getRequestDateRange(year: number, month: number | null, fullYear: boolean) {
	const start = fullYear
		? DateTime.utc(year, 1, 1).startOf("day")
		: DateTime.utc(year, (month ?? 0) + 1, 1).startOf("day");
	const end = fullYear ? start.endOf("year") : start.endOf("month");

	return {
		startDate: start.toJSDate(),
		endDate: end.toJSDate(),
	};
}

async function fetchDailyRequirements(params: {
	employeeId: string | undefined;
	startDate: Date;
	endDate: Date;
}): Promise<DailyWorkRequirements> {
	if (!params.employeeId) return {};

	try {
		return await getDailyWorkRequirementsForEmployee(params);
	} catch (error) {
		console.error("Error fetching calendar work policy requirements:", error);
		return {};
	}
}
```

In `GET`, after `const yearNum = parseInt(year, 10);`, add:

```ts
const monthNum = month === null ? null : parseInt(month, 10);
const { startDate, endDate } = getRequestDateRange(yearNum, monthNum, fullYear);
let dailyRequirements: DailyWorkRequirements = {};
```

Replace `parseInt(month!, 10)` in the single-month fetch with `monthNum!`.

After events are fetched and before returning, add:

```ts
dailyRequirements = await fetchDailyRequirements({
	employeeId: scopedEmployeeId,
	startDate,
	endDate,
});
```

Return it:

```ts
return superJsonResponse({
	events,
	total: events.length,
	dailyRequirements,
});
```

- [ ] **Step 5: Run route tests**

Run: `pnpm vitest run apps/webapp/src/app/api/calendar/events/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Run helper tests again**

Run: `pnpm vitest run apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/webapp/src/app/api/calendar/events/route.ts apps/webapp/src/app/api/calendar/events/route.test.ts apps/webapp/src/lib/calendar/work-policy-requirements.ts
git commit -m "feat: return calendar daily work requirements"
```

---

### Task 3: Client Parsing And Summary Aggregation

**Files:**
- Modify: `apps/webapp/src/lib/validations/calendar.ts`
- Modify: `apps/webapp/src/hooks/use-calendar-data.ts`
- Create: `apps/webapp/src/lib/calendar/work-hours-summary.ts`
- Create: `apps/webapp/src/lib/calendar/work-hours-summary.test.ts`

- [ ] **Step 1: Add validation schemas**

In `apps/webapp/src/lib/validations/calendar.ts`, add after `calendarEventSchema`:

```ts
export const dailyWorkRequirementSchema = z.object({
	requiredMinutes: z.number().int().nonnegative(),
	policyId: z.string(),
	policyName: z.string(),
});

export const dailyWorkRequirementsSchema = z.record(z.string(), dailyWorkRequirementSchema);
```

- [ ] **Step 2: Update the calendar data hook types and parsing**

In `apps/webapp/src/hooks/use-calendar-data.ts`, update imports:

```ts
import type { CalendarEvent, DailyWorkRequirements } from "@/lib/calendar/types";
import { calendarEventSchema, dailyWorkRequirementsSchema } from "@/lib/validations/calendar";
```

Add `dailyRequirements` to `UseCalendarDataResult`:

```ts
dailyRequirements: DailyWorkRequirements;
```

Change `fetchCalendarEvents` to return both events and requirements:

```ts
async function fetchCalendarEvents(
	organizationId: string,
	year: number,
	month: number | undefined,
	fullYear: boolean,
	filters: CalendarFilters,
): Promise<{ events: CalendarEvent[]; dailyRequirements: DailyWorkRequirements }> {
```

Parse the response like this:

```ts
const data = await parseSuperJsonResponse<{
	events: unknown[];
	total: number;
	dailyRequirements?: unknown;
}>(response);

const eventsSchema = z.array(calendarEventSchema);
return {
	events: eventsSchema.parse(data.events),
	dailyRequirements: dailyWorkRequirementsSchema.parse(data.dailyRequirements ?? {}),
};
```

Update the query default and return:

```ts
data: calendarData = { events: [], dailyRequirements: {} },
```

Use `calendarData.events` in `eventsByDate`, and return:

```ts
events: calendarData.events,
dailyRequirements: calendarData.dailyRequirements,
```

- [ ] **Step 3: Write failing summary tests**

Create `apps/webapp/src/lib/calendar/work-hours-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CalendarEvent, DailyWorkRequirements } from "./types";
import { buildDailyWorkHoursSummaries, formatSignedMinutes, formatTimeHours } from "./work-hours-summary";

function workPeriod(date: string, durationMinutes: number): CalendarEvent {
	return {
		id: `${date}-${durationMinutes}`,
		type: "work_period",
		date: new Date(`${date}T08:00:00.000Z`),
		endDate: new Date(`${date}T16:00:00.000Z`),
		title: "Work",
		color: "#10b981",
		metadata: { durationMinutes, employeeName: "Ada" },
	};
}

describe("buildDailyWorkHoursSummaries", () => {
	it("sums work periods and marks over when actual is above required", () => {
		const requirements: DailyWorkRequirements = {
			"2026-05-04": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
		};

		const summaries = buildDailyWorkHoursSummaries({
			events: [workPeriod("2026-05-04", 240), workPeriod("2026-05-04", 247)],
			dailyRequirements: requirements,
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 487,
			deltaMinutes: 7,
			status: "over",
		});
	});

	it("marks under when actual is below required", () => {
		const summaries = buildDailyWorkHoursSummaries({
			events: [workPeriod("2026-05-04", 449)],
			dailyRequirements: {
				"2026-05-04": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
			},
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 449,
			deltaMinutes: -31,
			status: "under",
		});
	});

	it("marks missing when required time exists but no work was recorded", () => {
		const summaries = buildDailyWorkHoursSummaries({
			events: [],
			dailyRequirements: {
				"2026-05-04": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
			},
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 0,
			deltaMinutes: -480,
			status: "missing",
		});
	});

	it("does not create summaries without a policy requirement", () => {
		const summaries = buildDailyWorkHoursSummaries({
			events: [workPeriod("2026-05-04", 480)],
			dailyRequirements: {},
		});

		expect(summaries.size).toBe(0);
	});
});

describe("format helpers", () => {
	it("formats required hours and signed deltas", () => {
		expect(formatTimeHours(480)).toBe("8:00h");
		expect(formatTimeHours(449)).toBe("7:29h");
		expect(formatSignedMinutes(7)).toBe("+0:07h");
		expect(formatSignedMinutes(-31)).toBe("-0:31h");
	});
});
```

- [ ] **Step 4: Run summary tests to verify they fail**

Run: `pnpm vitest run apps/webapp/src/lib/calendar/work-hours-summary.test.ts`

Expected: FAIL because `./work-hours-summary` does not exist yet.

- [ ] **Step 5: Implement summary helper**

Create `apps/webapp/src/lib/calendar/work-hours-summary.ts`:

```ts
import type {
	CalendarEvent,
	DailyWorkHoursStatus,
	DailyWorkHoursSummaries,
	DailyWorkRequirements,
} from "./types";
import { format } from "@/lib/datetime/luxon-utils";

interface BuildDailyWorkHoursSummariesOptions {
	events: CalendarEvent[];
	dailyRequirements: DailyWorkRequirements;
}

function getStatus(actualMinutes: number, requiredMinutes: number): DailyWorkHoursStatus {
	if (actualMinutes === 0) return "missing";
	if (actualMinutes > requiredMinutes) return "over";
	if (actualMinutes === requiredMinutes) return "met";
	return "under";
}

export function buildDailyWorkHoursSummaries({
	events,
	dailyRequirements,
}: BuildDailyWorkHoursSummariesOptions): DailyWorkHoursSummaries {
	const actualByDate = new Map<string, number>();

	for (const event of events) {
		if (event.type !== "work_period") continue;
		const dateKey = format(event.date, "yyyy-MM-dd");
		const durationMinutes = Number(event.metadata.durationMinutes ?? 0);
		if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) continue;
		actualByDate.set(dateKey, (actualByDate.get(dateKey) ?? 0) + durationMinutes);
	}

	const summaries: DailyWorkHoursSummaries = new Map();

	for (const [dateKey, requirement] of Object.entries(dailyRequirements)) {
		const actualMinutes = actualByDate.get(dateKey) ?? 0;
		const deltaMinutes = actualMinutes - requirement.requiredMinutes;
		summaries.set(dateKey, {
			...requirement,
			actualMinutes,
			deltaMinutes,
			status: getStatus(actualMinutes, requirement.requiredMinutes),
		});
	}

	return summaries;
}

export function formatTimeHours(minutes: number): string {
	const safeMinutes = Math.max(0, Math.round(minutes));
	const hours = Math.floor(safeMinutes / 60);
	const mins = safeMinutes % 60;
	return `${hours}:${String(mins).padStart(2, "0")}h`;
}

export function formatSignedMinutes(minutes: number): string {
	const sign = minutes >= 0 ? "+" : "-";
	return `${sign}${formatTimeHours(Math.abs(minutes))}`;
}
```

- [ ] **Step 6: Run client helper tests**

Run: `pnpm vitest run apps/webapp/src/lib/calendar/work-hours-summary.test.ts`

Expected: PASS.

- [ ] **Step 7: Run calendar route and requirement helper tests**

Run: `pnpm vitest run apps/webapp/src/app/api/calendar/events/route.test.ts apps/webapp/src/lib/calendar/work-policy-requirements.test.ts apps/webapp/src/lib/calendar/work-hours-summary.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/webapp/src/lib/validations/calendar.ts apps/webapp/src/hooks/use-calendar-data.ts apps/webapp/src/lib/calendar/work-hours-summary.ts apps/webapp/src/lib/calendar/work-hours-summary.test.ts
git commit -m "feat: summarize calendar daily work hours"
```

---

### Task 4: Day And Week Requirement Strip

**Files:**
- Create: `apps/webapp/src/components/calendar/daily-requirement-strip.tsx`
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`

- [ ] **Step 1: Create compact visual component**

Create `apps/webapp/src/components/calendar/daily-requirement-strip.tsx`:

```tsx
"use client";

import type { DateTime } from "luxon";
import type { DailyWorkHoursSummaries, DailyWorkHoursSummary } from "@/lib/calendar/types";
import { formatSignedMinutes, formatTimeHours } from "@/lib/calendar/work-hours-summary";
import { cn } from "@/lib/utils";

interface DailyRequirementStripProps {
	dates: DateTime[];
	summaries: DailyWorkHoursSummaries;
}

function getStatusClass(summary: DailyWorkHoursSummary | undefined): string {
	if (!summary) return "border-transparent text-transparent";
	if (summary.status === "under") return "border-red-500 text-red-950 dark:text-red-100";
	if (summary.status === "missing") return "border-muted text-muted-foreground";
	return "border-emerald-500 text-emerald-950 dark:text-emerald-100";
}

export function DailyRequirementStrip({ dates, summaries }: DailyRequirementStripProps) {
	if (dates.length === 0) return null;

	const hasAnyRequirement = dates.some((date) => summaries.has(date.toFormat("yyyy-MM-dd")));
	if (!hasAnyRequirement) return null;

	return (
		<div
			className="grid border-x border-t bg-background/80 text-right text-[11px] leading-tight tabular-nums"
			style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }}
			aria-label="Daily work policy requirement summary"
		>
			{dates.map((date) => {
				const dateKey = date.toFormat("yyyy-MM-dd");
				const summary = summaries.get(dateKey);

				return (
					<div
						key={dateKey}
						className={cn(
							"min-h-12 border-r border-t-4 px-3 py-2 last:border-r-0",
							getStatusClass(summary),
						)}
					>
						{summary ? (
							<>
								<div className="font-semibold">{formatTimeHours(summary.requiredMinutes)}</div>
								{summary.actualMinutes > 0 && (
									<div className="text-muted-foreground">
										{formatSignedMinutes(summary.deltaMinutes)}
									</div>
								)}
							</>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 2: Pass summaries through `CalendarView`**

In `apps/webapp/src/components/calendar/calendar-view.tsx`, change the hook destructure:

```ts
const { events, dailyRequirements, isLoading, error, refetch } = useCalendarData({
```

Replace the current `workHoursData` `useMemo` block with:

```ts
const workHoursData = useMemo(
	() => buildDailyWorkHoursSummaries({ events, dailyRequirements }),
	[events, dailyRequirements],
);
```

Add import:

```ts
import { buildDailyWorkHoursSummaries } from "@/lib/calendar/work-hours-summary";
```

Pass the summaries to `ScheduleXWrapper`:

```tsx
<ScheduleXWrapper
	events={events}
	isLoading={isLoading}
	viewMode={viewMode}
	onViewModeChange={setViewMode}
	onEventClick={handleEventClick}
	onRangeChange={handleRangeChange}
	onRefresh={refetch}
	workHoursData={workHoursData}
/>
```

- [ ] **Step 3: Render the strip in Schedule-X wrapper**

In `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`, add imports:

```ts
import type { DailyWorkHoursSummaries } from "@/lib/calendar/types";
import { DailyRequirementStrip } from "./daily-requirement-strip";
```

Add prop to `ScheduleXCalendarWrapperProps`:

```ts
workHoursData?: DailyWorkHoursSummaries;
```

Destructure it with a default:

```ts
workHoursData = new Map(),
```

Add this memo after `dateRangeDisplay`:

```ts
const visibleRequirementDates = useMemo(() => {
	if (viewMode === "day") return [currentDate.startOf("day")];
	if (viewMode === "week") {
		const { start } = getWeekBounds(currentDate, weekStartDay);
		return Array.from({ length: 7 }, (_, index) => start.plus({ days: index }));
	}
	return [];
}, [currentDate, viewMode, weekStartDay]);
```

Render this before the `schedule-x-container` div:

```tsx
<DailyRequirementStrip dates={visibleRequirementDates} summaries={workHoursData} />
```

- [ ] **Step 4: Run typecheck-adjacent tests**

Run: `pnpm vitest run apps/webapp/src/lib/calendar/work-hours-summary.test.ts apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/webapp/src/components/calendar/daily-requirement-strip.tsx apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/schedule-x-calendar.tsx
git commit -m "feat: show work requirements in calendar week view"
```

---

### Task 5: Year View Policy-Derived Status

**Files:**
- Modify: `apps/webapp/src/components/calendar/year-calendar-view.tsx`

- [ ] **Step 1: Update year view types**

In `apps/webapp/src/components/calendar/year-calendar-view.tsx`, add import:

```ts
import type { DailyWorkHoursSummaries } from "@/lib/calendar/types";
```

Change both `workHoursData` prop types from:

```ts
workHoursData?: Map<string, { expected: number; actual: number }>;
```

to:

```ts
workHoursData?: DailyWorkHoursSummaries;
```

- [ ] **Step 2: Replace hardcoded status logic**

Inside the day render loop, replace the `workStatus` calculation with:

```ts
const workStatus: "met" | "over" | "under" | "missing" | "none" = workHours?.status ?? "none";
```

Update the dot class list to include `missing`:

```tsx
workStatus === "met" && "bg-green-500",
workStatus === "over" && "bg-green-500",
workStatus === "under" && "bg-red-500",
workStatus === "missing" && "bg-muted-foreground",
```

Remove any remaining references to `expected`, `actual`, `8 * 60`, `0.95`, or `1.1` from the year view.

- [ ] **Step 3: Run targeted tests**

Run: `pnpm vitest run apps/webapp/src/lib/calendar/work-hours-summary.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit Task 5**

```bash
git add apps/webapp/src/components/calendar/year-calendar-view.tsx
git commit -m "fix: use policy hours in calendar year view"
```

---

### Task 6: Final Verification

**Files:**
- Verify only; no planned source changes unless checks reveal issues.

- [ ] **Step 1: Run all targeted calendar tests**

Run: `pnpm vitest run apps/webapp/src/app/api/calendar/events/route.test.ts apps/webapp/src/lib/calendar/work-policy-requirements.test.ts apps/webapp/src/lib/calendar/work-hours-summary.test.ts apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts apps/webapp/src/lib/calendar/schedule-x-locale.test.ts`

Expected: PASS.

- [ ] **Step 2: Run lint/type/build check available for this repo**

Run: `CI=true pnpm build`

Expected: PASS. If the build fails because required environment variables or Phase CLI secrets are unavailable, record the skipped verification and include the exact missing requirement in the final response.

- [ ] **Step 3: Inspect final diff**

Run: `git status --short`

Expected: Only files touched by this plan are modified, plus any pre-existing unrelated changes that must not be reverted.

Run: `git diff --stat HEAD`

Expected: Diff includes calendar requirement helper, API response, hook parsing, summary helper, and calendar UI changes.

- [ ] **Step 4: Commit verification fixes if needed**

If Step 1 or Step 2 required fixes, commit only those fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize calendar work policy hours"
```

If no fixes were needed, do not create an empty commit.
