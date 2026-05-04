# Personal Workday Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first daily workday timeline on the existing time-tracking page, showing shifts, work periods, absences, pending requests, and warnings for the signed-in employee.

**Architecture:** Add a server-derived timeline model alongside existing `time-tracking/page-data.ts`. Keep date parsing and timeline normalization as pure, tested units, then add a database loader filtered by both `organizationId` and `employeeId`, and finally render the timeline between the clock widget and weekly summary.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, Luxon, Tolgee, Vitest, Testing Library, shadcn-style UI components.

---

## File Structure

- Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline.types.ts`: Owns the timeline data contract shared by loader and UI.
- Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-date.ts`: Parses selected date params and computes timezone-aware day bounds.
- Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-date.test.ts`: Tests invalid date fallback and timezone day bounds.
- Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-normalize.ts`: Converts source rows into sorted timeline items and warnings.
- Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-normalize.test.ts`: Tests ordering, warnings, empty states, and request filtering.
- Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.ts`: Loads work periods, shifts, absences, and pending requests using org/employee/date filters.
- Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.test.ts`: Tests multi-tenant filter inputs and graceful failure shape.
- Create `apps/webapp/src/components/time-tracking/personal-workday-timeline.tsx`: Renders day picker, warning summary, timeline rows, empty state, and unavailable state.
- Create `apps/webapp/src/components/time-tracking/personal-workday-timeline.test.tsx`: Tests rendered states and day picker links.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/page-data.ts`: Accept `searchParams`, load timeline safely, and return `timelineResult`.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx`: Accept `searchParams` and insert the timeline below `ClockInOutWidget`.

## Task 1: Date Parsing And Timeline Types

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline.types.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-date.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-date.test.ts`

- [ ] **Step 1: Write the failing date utility tests**

Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-date.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getSelectedWorkdayDate } from "./workday-timeline-date";

describe("getSelectedWorkdayDate", () => {
	it("uses a valid YYYY-MM-DD date param in the employee timezone", () => {
		const result = getSelectedWorkdayDate({
			dateParam: "2026-05-03",
			timezone: "Europe/Berlin",
			now: new Date("2026-05-04T10:00:00.000Z"),
		});

		expect(result.dateKey).toBe("2026-05-03");
		expect(result.previousDateKey).toBe("2026-05-02");
		expect(result.nextDateKey).toBe("2026-05-04");
		expect(result.startUtc.toISO()).toBe("2026-05-02T22:00:00.000Z");
		expect(result.endUtc.toISO()).toBe("2026-05-03T21:59:59.999Z");
	});

	it("falls back to today in the employee timezone when the date param is invalid", () => {
		const result = getSelectedWorkdayDate({
			dateParam: "not-a-date",
			timezone: "America/New_York",
			now: new Date("2026-05-04T02:30:00.000Z"),
		});

		expect(result.dateKey).toBe("2026-05-03");
		expect(result.label).toBe("May 3, 2026");
	});

	it("falls back to today when the date param is missing", () => {
		const result = getSelectedWorkdayDate({
			dateParam: undefined,
			timezone: "UTC",
			now: new Date("2026-05-04T02:30:00.000Z"),
		});

		expect(result.dateKey).toBe("2026-05-04");
		expect(result.todayDateKey).toBe("2026-05-04");
	});
});
```

- [ ] **Step 2: Run the date tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/app/[locale]/\(app\)/time-tracking/workday-timeline-date.test.ts`

Expected: FAIL with an import error for `./workday-timeline-date`.

- [ ] **Step 3: Add timeline types**

Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline.types.ts`:

```ts
import type { WorkPeriodAutoAdjustmentReason } from "@/db/schema";

export type WorkdayTimelineItemType =
	| "shift"
	| "work-period"
	| "break"
	| "absence"
	| "pending-request"
	| "warning";

export type WorkdayTimelineSeverity = "info" | "warning" | "danger";

export interface WorkdayTimelineLink {
	label: string;
	href: string;
}

interface WorkdayTimelineBaseItem {
	id: string;
	type: WorkdayTimelineItemType;
	title: string;
	subtitle?: string;
	startTime?: Date;
	endTime?: Date | null;
	startLabel?: string;
	endLabel?: string;
	badge?: string;
	severity?: WorkdayTimelineSeverity;
	link?: WorkdayTimelineLink;
}

export interface WorkdayTimelineShiftItem extends WorkdayTimelineBaseItem {
	type: "shift";
	status: string;
}

export interface WorkdayTimelineWorkPeriodItem extends WorkdayTimelineBaseItem {
	type: "work-period";
	isActive: boolean;
	durationMinutes: number | null;
	approvalStatus: "approved" | "pending" | "rejected";
	wasAutoAdjusted: boolean;
	autoAdjustmentReason: WorkPeriodAutoAdjustmentReason | null;
}

export interface WorkdayTimelineBreakItem extends WorkdayTimelineBaseItem {
	type: "break";
}

export interface WorkdayTimelineAbsenceItem extends WorkdayTimelineBaseItem {
	type: "absence";
	status: "pending" | "approved" | "rejected";
	color: string | null;
}

export interface WorkdayTimelinePendingRequestItem extends WorkdayTimelineBaseItem {
	type: "pending-request";
	sourceType: "time_correction" | "absence" | "travel_expense" | "shift";
	status: "pending" | "approved" | "rejected" | "cancelled";
}

export interface WorkdayTimelineWarningItem extends WorkdayTimelineBaseItem {
	type: "warning";
	severity: WorkdayTimelineSeverity;
}

export type WorkdayTimelineItem =
	| WorkdayTimelineShiftItem
	| WorkdayTimelineWorkPeriodItem
	| WorkdayTimelineBreakItem
	| WorkdayTimelineAbsenceItem
	| WorkdayTimelinePendingRequestItem
	| WorkdayTimelineWarningItem;

export interface SelectedWorkdayDate {
	dateKey: string;
	todayDateKey: string;
	previousDateKey: string;
	nextDateKey: string;
	label: string;
	startUtc: import("luxon").DateTime;
	endUtc: import("luxon").DateTime;
}

export interface WorkdayTimelineData {
	selectedDate: SelectedWorkdayDate;
	items: WorkdayTimelineItem[];
	dayWarnings: WorkdayTimelineWarningItem[];
	hasScheduledContext: boolean;
	hasRecordedActivity: boolean;
}

export type WorkdayTimelineResult =
	| { success: true; data: WorkdayTimelineData }
	| { success: false; selectedDate: SelectedWorkdayDate; error: string };
```

- [ ] **Step 4: Add date parsing implementation**

Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-date.ts`:

```ts
import { DateTime } from "luxon";
import type { SelectedWorkdayDate } from "./workday-timeline.types";

interface GetSelectedWorkdayDateInput {
	dateParam: string | undefined;
	timezone: string;
	now?: Date;
}

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getSelectedWorkdayDate({
	dateParam,
	timezone,
	now,
}: GetSelectedWorkdayDateInput): SelectedWorkdayDate {
	const today = DateTime.fromJSDate(now ?? new Date(), { zone: "utc" }).setZone(timezone);
	const parsed =
		dateParam && DATE_PARAM_PATTERN.test(dateParam)
			? DateTime.fromISO(dateParam, { zone: timezone })
			: null;
	const selected = parsed?.isValid ? parsed : today;
	const selectedDay = selected.startOf("day");

	return {
		dateKey: selectedDay.toISODate() ?? today.toISODate() ?? "",
		todayDateKey: today.toISODate() ?? "",
		previousDateKey: selectedDay.minus({ days: 1 }).toISODate() ?? "",
		nextDateKey: selectedDay.plus({ days: 1 }).toISODate() ?? "",
		label: selectedDay.toLocaleString(DateTime.DATE_FULL),
		startUtc: selectedDay.toUTC(),
		endUtc: selectedDay.endOf("day").toUTC(),
	};
}
```

- [ ] **Step 5: Run the date tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/app/[locale]/\(app\)/time-tracking/workday-timeline-date.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit date utilities**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/time-tracking/workday-timeline.types.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/workday-timeline-date.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/workday-timeline-date.test.ts
git commit -m "feat: add workday timeline date model"
```

## Task 2: Timeline Normalization

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-normalize.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-normalize.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-normalize.test.ts`:

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { SelectedWorkdayDate } from "./workday-timeline.types";
import { normalizeWorkdayTimeline } from "./workday-timeline-normalize";

const selectedDate: SelectedWorkdayDate = {
	dateKey: "2026-05-03",
	todayDateKey: "2026-05-03",
	previousDateKey: "2026-05-02",
	nextDateKey: "2026-05-04",
	label: "May 3, 2026",
	startUtc: DateTime.fromISO("2026-05-02T22:00:00.000Z"),
	endUtc: DateTime.fromISO("2026-05-03T21:59:59.999Z"),
};

describe("normalizeWorkdayTimeline", () => {
	it("orders day warnings and all-day context before timed timeline items", () => {
		const result = normalizeWorkdayTimeline({
			selectedDate,
			timezone: "Europe/Berlin",
			workPeriods: [
				{
					id: "period-1",
					startTime: new Date("2026-05-03T07:00:00.000Z"),
					endTime: new Date("2026-05-03T15:00:00.000Z"),
					durationMinutes: 480,
					approvalStatus: "approved",
					pendingChanges: null,
					wasAutoAdjusted: false,
					autoAdjustmentReason: null,
				},
			],
			shifts: [
				{
					id: "shift-1",
					date: "2026-05-03",
					startTime: "08:00",
					endTime: "16:00",
					status: "published",
					notes: "Front desk",
				},
			],
			absences: [
				{
					id: "absence-1",
					startDate: "2026-05-03",
					endDate: "2026-05-03",
					startPeriod: "morning",
					endPeriod: "morning",
					status: "approved",
					categoryName: "Doctor appointment",
					categoryColor: "#2563eb",
				},
			],
			pendingRequests: [],
		});

		expect(result.items.map((item) => item.type)).toEqual([
			"absence",
			"shift",
			"work-period",
		]);
		expect(result.hasScheduledContext).toBe(true);
		expect(result.hasRecordedActivity).toBe(true);
	});

	it("adds warning rows for pending edits, active periods, and auto adjustments", () => {
		const result = normalizeWorkdayTimeline({
			selectedDate,
			timezone: "Europe/Berlin",
			workPeriods: [
				{
					id: "period-pending",
					startTime: new Date("2026-05-03T07:00:00.000Z"),
					endTime: null,
					durationMinutes: null,
					approvalStatus: "pending",
					pendingChanges: "{\"reason\":\"corrected clock out\"}",
					wasAutoAdjusted: true,
					autoAdjustmentReason: {
						breakInsertedMinutes: 30,
						regulationName: "Default break policy",
						originalDurationMinutes: 510,
					},
				},
			],
			shifts: [],
			absences: [],
			pendingRequests: [],
		});

		expect(result.dayWarnings.map((warning) => warning.id)).toEqual([
			"warning:pending-edit:period-pending",
			"warning:missing-clock-out:period-pending",
			"warning:auto-adjusted:period-pending",
		]);
		expect(result.dayWarnings[0].link).toEqual({ label: "Review request", href: "/my-requests" });
	});

	it("keeps only pending requests and ignores travel expenses for the workday timeline", () => {
		const result = normalizeWorkdayTimeline({
			selectedDate,
			timezone: "Europe/Berlin",
			workPeriods: [],
			shifts: [],
			absences: [],
			pendingRequests: [
				{
					id: "time_correction:req-1",
					sourceType: "time_correction",
					status: "pending",
					title: "time_correction",
					subtitle: "time_entry_correction",
					submittedAt: new Date("2026-05-03T08:00:00.000Z"),
					sourceHref: "/time-tracking",
				},
				{
					id: "travel_expense:req-2",
					sourceType: "travel_expense",
					status: "pending",
					title: "travel_expense",
					subtitle: "Trip",
					submittedAt: new Date("2026-05-03T08:00:00.000Z"),
					sourceHref: "/travel-expenses",
				},
			],
		});

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({ type: "pending-request", sourceType: "time_correction" });
	});
});
```

- [ ] **Step 2: Run normalization tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/app/[locale]/\(app\)/time-tracking/workday-timeline-normalize.test.ts`

Expected: FAIL with an import error for `./workday-timeline-normalize`.

- [ ] **Step 3: Add normalization implementation**

Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-normalize.ts`:

```ts
import { DateTime } from "luxon";
import { formatDuration } from "@/lib/time-tracking/time-utils";
import { formatTimeInZone } from "@/lib/time-tracking/timezone-utils";
import type {
	SelectedWorkdayDate,
	WorkdayTimelineAbsenceItem,
	WorkdayTimelineData,
	WorkdayTimelineItem,
	WorkdayTimelinePendingRequestItem,
	WorkdayTimelineShiftItem,
	WorkdayTimelineWarningItem,
	WorkdayTimelineWorkPeriodItem,
} from "./workday-timeline.types";

interface WorkdayWorkPeriodSource {
	id: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	approvalStatus: "approved" | "pending" | "rejected";
	pendingChanges: string | null;
	wasAutoAdjusted: boolean;
	autoAdjustmentReason: WorkdayTimelineWorkPeriodItem["autoAdjustmentReason"];
}

interface WorkdayShiftSource {
	id: string;
	date: string;
	startTime: string;
	endTime: string;
	status: string;
	notes: string | null;
}

interface WorkdayAbsenceSource {
	id: string;
	startDate: string;
	endDate: string;
	startPeriod: string;
	endPeriod: string;
	status: "pending" | "approved" | "rejected";
	categoryName: string;
	categoryColor: string | null;
}

interface WorkdayPendingRequestSource {
	id: string;
	sourceType: "time_correction" | "absence" | "travel_expense" | "shift";
	status: "pending" | "approved" | "rejected" | "cancelled";
	title: string;
	subtitle: string;
	submittedAt: Date;
	sourceHref: string;
}

interface NormalizeWorkdayTimelineInput {
	selectedDate: SelectedWorkdayDate;
	timezone: string;
	workPeriods: WorkdayWorkPeriodSource[];
	shifts: WorkdayShiftSource[];
	absences: WorkdayAbsenceSource[];
	pendingRequests: WorkdayPendingRequestSource[];
}

export function normalizeWorkdayTimeline({
	selectedDate,
	timezone,
	workPeriods,
	shifts,
	absences,
	pendingRequests,
}: NormalizeWorkdayTimelineInput): WorkdayTimelineData {
	const shiftItems = shifts.map((shift): WorkdayTimelineShiftItem => {
		const start = DateTime.fromISO(`${shift.date}T${shift.startTime}`, { zone: timezone });
		let end = DateTime.fromISO(`${shift.date}T${shift.endTime}`, { zone: timezone });
		if (end <= start) {
			end = end.plus({ days: 1 });
		}

		return {
			id: `shift:${shift.id}`,
			type: "shift",
			title: "Scheduled shift",
			subtitle: shift.notes ?? undefined,
			startTime: start.toJSDate(),
			endTime: end.toJSDate(),
			startLabel: start.toFormat("HH:mm"),
			endLabel: end.toFormat("HH:mm"),
			badge: shift.status,
			status: shift.status,
		};
	});

	const absenceItems = absences.map((absence): WorkdayTimelineAbsenceItem => ({
		id: `absence:${absence.id}`,
		type: "absence",
		title: absence.categoryName,
		subtitle: absencePeriodLabel(absence.startPeriod, absence.endPeriod),
		badge: absence.status,
		status: absence.status,
		color: absence.categoryColor,
		severity: absence.status === "pending" ? "warning" : "info",
		link: { label: "View absence", href: "/absences" },
	}));

	const workPeriodItems = workPeriods.map((period): WorkdayTimelineWorkPeriodItem => ({
		id: `work-period:${period.id}`,
		type: "work-period",
		title: period.endTime ? "Work period" : "Work period in progress",
		subtitle: period.durationMinutes ? formatDuration(period.durationMinutes) : undefined,
		startTime: period.startTime,
		endTime: period.endTime,
		startLabel: formatTimeInZone(period.startTime, timezone),
		endLabel: period.endTime ? formatTimeInZone(period.endTime, timezone) : undefined,
		badge: period.endTime ? undefined : "In progress",
		isActive: !period.endTime,
		durationMinutes: period.durationMinutes,
		approvalStatus: period.approvalStatus,
		wasAutoAdjusted: period.wasAutoAdjusted,
		autoAdjustmentReason: period.autoAdjustmentReason,
	}));

	const requestItems = pendingRequests
		.filter((request) => request.status === "pending")
		.filter((request) => request.sourceType !== "travel_expense")
		.map((request): WorkdayTimelinePendingRequestItem => ({
			id: `pending-request:${request.id}`,
			type: "pending-request",
			title: requestTitle(request.sourceType),
			subtitle: request.subtitle,
			startTime: request.submittedAt,
			startLabel: formatTimeInZone(request.submittedAt, timezone),
			badge: "Pending",
			severity: "warning",
			link: { label: "Review request", href: request.sourceHref },
			sourceType: request.sourceType,
			status: request.status,
		}));

	const dayWarnings = workPeriods.flatMap((period) => warningItemsForPeriod(period));
	const timedItems = [...shiftItems, ...workPeriodItems, ...requestItems].sort(compareTimedItems);
	const items: WorkdayTimelineItem[] = [...dayWarnings, ...absenceItems, ...timedItems];

	return {
		selectedDate,
		items,
		dayWarnings,
		hasScheduledContext: shiftItems.length > 0 || absenceItems.length > 0,
		hasRecordedActivity: workPeriodItems.length > 0,
	};
}

function warningItemsForPeriod(period: WorkdayWorkPeriodSource): WorkdayTimelineWarningItem[] {
	const warnings: WorkdayTimelineWarningItem[] = [];

	if (period.approvalStatus === "pending" || period.pendingChanges) {
		warnings.push({
			id: `warning:pending-edit:${period.id}`,
			type: "warning",
			title: "Unapproved edit pending",
			subtitle: "A time correction for this day is waiting for approval.",
			severity: "warning",
			link: { label: "Review request", href: "/my-requests" },
		});
	}

	if (!period.endTime) {
		warnings.push({
			id: `warning:missing-clock-out:${period.id}`,
			type: "warning",
			title: "Missing clock-out",
			subtitle: "This work period is still active.",
			severity: "warning",
			link: { label: "Open time tracking", href: "/time-tracking" },
		});
	}

	if (period.wasAutoAdjusted) {
		warnings.push({
			id: `warning:auto-adjusted:${period.id}`,
			type: "warning",
			title: "Break adjustment applied",
			subtitle: period.autoAdjustmentReason
				? `A ${period.autoAdjustmentReason.breakInsertedMinutes}-minute break was added for ${period.autoAdjustmentReason.regulationName}.`
				: "A break adjustment was applied for compliance.",
			severity: "info",
			link: { label: "View entry", href: "/time-tracking" },
		});
	}

	return warnings;
}

function absencePeriodLabel(startPeriod: string, endPeriod: string): string {
	if (startPeriod === "full_day" && endPeriod === "full_day") {
		return "Full day";
	}

	if (startPeriod === endPeriod) {
		return startPeriod.replace("_", " ");
	}

	return `${startPeriod.replace("_", " ")} to ${endPeriod.replace("_", " ")}`;
}

function requestTitle(sourceType: WorkdayPendingRequestSource["sourceType"]): string {
	if (sourceType === "time_correction") {
		return "Time correction pending";
	}

	if (sourceType === "absence") {
		return "Absence request pending";
	}

	if (sourceType === "shift") {
		return "Shift request pending";
	}

	return "Request pending";
}

function compareTimedItems(a: WorkdayTimelineItem, b: WorkdayTimelineItem): number {
	const aTime = a.startTime?.getTime() ?? Number.MAX_SAFE_INTEGER;
	const bTime = b.startTime?.getTime() ?? Number.MAX_SAFE_INTEGER;
	return aTime - bTime;
}
```

- [ ] **Step 4: Run normalization tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/app/[locale]/\(app\)/time-tracking/workday-timeline-normalize.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit normalization**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/time-tracking/workday-timeline-normalize.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/workday-timeline-normalize.test.ts
git commit -m "feat: normalize workday timeline items"
```

## Task 3: Server Data Loader

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.test.ts`

- [ ] **Step 1: Write failing loader tests**

Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	workPeriodFindMany: vi.fn(),
	shiftFindMany: vi.fn(),
	absenceFindMany: vi.fn(),
	getSelfServiceRequests: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			workPeriod: { findMany: mocks.workPeriodFindMany },
			shift: { findMany: mocks.shiftFindMany },
			absenceEntry: { findMany: mocks.absenceFindMany },
		},
	},
}));

vi.mock("@/lib/self-service-requests/get-self-service-requests", () => ({
	getSelfServiceRequests: mocks.getSelfServiceRequests,
}));

import { getWorkdayTimelineData } from "./workday-timeline-data";

describe("getWorkdayTimelineData", () => {
	beforeEach(() => {
		mocks.workPeriodFindMany.mockReset();
		mocks.shiftFindMany.mockReset();
		mocks.absenceFindMany.mockReset();
		mocks.getSelfServiceRequests.mockReset();

		mocks.workPeriodFindMany.mockResolvedValue([]);
		mocks.shiftFindMany.mockResolvedValue([]);
		mocks.absenceFindMany.mockResolvedValue([]);
		mocks.getSelfServiceRequests.mockResolvedValue({ items: [], counts: { pending: 0, requiredFixes: 0, recentDecisions: 0, total: 0 }, sourceErrors: [] });
	});

	it("loads all timeline sources for the selected employee and organization", async () => {
		const result = await getWorkdayTimelineData({
			employeeId: "employee-1",
			organizationId: "org-1",
			timezone: "Europe/Berlin",
			dateParam: "2026-05-03",
		});

		expect(result.success).toBe(true);
		expect(mocks.workPeriodFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.shiftFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.absenceFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.getSelfServiceRequests).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			filters: { status: "pending" },
		});
	});

	it("returns an unavailable result if a source throws", async () => {
		mocks.shiftFindMany.mockRejectedValue(new Error("database unavailable"));

		const result = await getWorkdayTimelineData({
			employeeId: "employee-1",
			organizationId: "org-1",
			timezone: "UTC",
			dateParam: "2026-05-03",
		});

		expect(result).toMatchObject({
			success: false,
			error: "Timeline unavailable",
		});
		if (!result.success) {
			expect(result.selectedDate.dateKey).toBe("2026-05-03");
		}
	});
});
```

- [ ] **Step 2: Run loader tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/app/[locale]/\(app\)/time-tracking/workday-timeline-data.test.ts`

Expected: FAIL with an import error for `./workday-timeline-data`.

- [ ] **Step 3: Add loader implementation**

Create `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.ts`:

```ts
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { absenceEntry, shift, workPeriod } from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { getSelfServiceRequests } from "@/lib/self-service-requests/get-self-service-requests";
import { getSelectedWorkdayDate } from "./workday-timeline-date";
import { normalizeWorkdayTimeline } from "./workday-timeline-normalize";
import type { WorkdayTimelineResult } from "./workday-timeline.types";

interface GetWorkdayTimelineDataInput {
	employeeId: string;
	organizationId: string;
	timezone: string;
	dateParam: string | undefined;
	now?: Date;
}

export async function getWorkdayTimelineData({
	employeeId,
	organizationId,
	timezone,
	dateParam,
	now,
}: GetWorkdayTimelineDataInput): Promise<WorkdayTimelineResult> {
	const selectedDate = getSelectedWorkdayDate({ dateParam, timezone, now });

	try {
		const startDate = dateToDB(selectedDate.startUtc)!;
		const endDate = dateToDB(selectedDate.endUtc)!;

		const [workPeriods, shifts, absences, requests] = await Promise.all([
			db.query.workPeriod.findMany({
				where: and(
					eq(workPeriod.organizationId, organizationId),
					eq(workPeriod.employeeId, employeeId),
					gte(workPeriod.startTime, startDate),
					lte(workPeriod.startTime, endDate),
				),
				orderBy: [workPeriod.startTime],
			}),
			db.query.shift.findMany({
				where: and(
					eq(shift.organizationId, organizationId),
					eq(shift.employeeId, employeeId),
					eq(shift.date, selectedDate.dateKey),
					eq(shift.status, "published"),
				),
			}),
			db.query.absenceEntry.findMany({
				where: and(
					eq(absenceEntry.organizationId, organizationId),
					eq(absenceEntry.employeeId, employeeId),
					lte(absenceEntry.startDate, selectedDate.dateKey),
					gte(absenceEntry.endDate, selectedDate.dateKey),
				),
				with: { category: true },
			}),
			getSelfServiceRequests({
				employeeId,
				organizationId,
				filters: { status: "pending" },
			}),
		]);

		return {
			success: true,
			data: normalizeWorkdayTimeline({
				selectedDate,
				timezone,
				workPeriods: workPeriods.map((period) => ({
					id: period.id,
					startTime: period.startTime,
					endTime: period.endTime,
					durationMinutes: period.durationMinutes,
					approvalStatus: period.approvalStatus,
					pendingChanges: period.pendingChanges ? JSON.stringify(period.pendingChanges) : null,
					wasAutoAdjusted: period.wasAutoAdjusted,
					autoAdjustmentReason: period.autoAdjustmentReason,
				})),
				shifts: shifts.map((row) => ({
					id: row.id,
					date: selectedDate.dateKey,
					startTime: row.startTime,
					endTime: row.endTime,
					status: row.status,
					notes: row.notes,
				})),
				absences: absences.map((absence) => ({
					id: absence.id,
					startDate: absence.startDate,
					endDate: absence.endDate,
					startPeriod: absence.startPeriod,
					endPeriod: absence.endPeriod,
					status: absence.status,
					categoryName: absence.category?.name ?? "Absence",
					categoryColor: absence.category?.color ?? null,
				})),
				pendingRequests: requests.items.map((request) => ({
					id: request.id,
					sourceType: request.sourceType,
					status: request.status,
					title: request.title,
					subtitle: request.subtitle,
					submittedAt: request.submittedAt,
					sourceHref: request.sourceHref,
				})),
			}),
		};
	} catch {
		return { success: false, selectedDate, error: "Timeline unavailable" };
	}
}
```

- [ ] **Step 4: Run loader tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/app/[locale]/\(app\)/time-tracking/workday-timeline-data.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit loader**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/time-tracking/workday-timeline-data.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/workday-timeline-data.test.ts
git commit -m "feat: load workday timeline data"
```

## Task 4: Timeline UI Component

**Files:**
- Create: `apps/webapp/src/components/time-tracking/personal-workday-timeline.tsx`
- Test: `apps/webapp/src/components/time-tracking/personal-workday-timeline.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/webapp/src/components/time-tracking/personal-workday-timeline.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { PersonalWorkdayTimeline } from "./personal-workday-timeline";
import type { WorkdayTimelineData, WorkdayTimelineResult } from "@/app/[locale]/(app)/time-tracking/workday-timeline.types";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>{children}</a>
	),
}));

const selectedDate = {
	dateKey: "2026-05-03",
	todayDateKey: "2026-05-03",
	previousDateKey: "2026-05-02",
	nextDateKey: "2026-05-04",
	label: "May 3, 2026",
	startUtc: DateTime.fromISO("2026-05-03T00:00:00.000Z"),
	endUtc: DateTime.fromISO("2026-05-03T23:59:59.999Z"),
};

function success(data: Partial<WorkdayTimelineData>): WorkdayTimelineResult {
	return {
		success: true,
		data: {
			selectedDate,
			items: [],
			dayWarnings: [],
			hasScheduledContext: false,
			hasRecordedActivity: false,
			...data,
		},
	};
}

describe("PersonalWorkdayTimeline", () => {
	it("renders warning summary and chronological items", () => {
		render(
			<PersonalWorkdayTimeline
				result={success({
					dayWarnings: [
						{
							id: "warning:pending-edit:1",
							type: "warning",
							title: "Unapproved edit pending",
							subtitle: "A time correction for this day is waiting for approval.",
							severity: "warning",
							link: { label: "Review request", href: "/my-requests" },
						},
					],
					items: [
						{
							id: "warning:pending-edit:1",
							type: "warning",
							title: "Unapproved edit pending",
							subtitle: "A time correction for this day is waiting for approval.",
							severity: "warning",
							link: { label: "Review request", href: "/my-requests" },
						},
						{
							id: "shift:1",
							type: "shift",
							title: "Scheduled shift",
							startLabel: "08:00",
							endLabel: "16:00",
							status: "published",
						},
					],
				})}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Workday timeline" })).toBeInTheDocument();
		expect(screen.getByText("Unapproved edit pending")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Review request" })).toHaveAttribute("href", "/my-requests");
		expect(screen.getByText("08:00 - 16:00")).toBeInTheDocument();
	});

	it("renders a useful empty state", () => {
		render(<PersonalWorkdayTimeline result={success({})} />);

		expect(screen.getByText("No activity recorded for this day."));
		expect(screen.getByText("There are no shifts, absences, or time entries for the selected day yet."));
	});

	it("renders an unavailable alert without throwing", () => {
		render(
			<PersonalWorkdayTimeline
				result={{ success: false, selectedDate, error: "Timeline unavailable" }}
			/>,
		);

		expect(screen.getByText("Timeline unavailable")).toBeInTheDocument();
		expect(screen.getByText("Clocking time still works. Try refreshing this view later."));
	});

	it("renders day picker links", () => {
		render(<PersonalWorkdayTimeline result={success({})} />);

		expect(screen.getByRole("link", { name: "Previous day" })).toHaveAttribute("href", "/time-tracking?date=2026-05-02");
		expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("href", "/time-tracking?date=2026-05-03");
		expect(screen.getByRole("link", { name: "Next day" })).toHaveAttribute("href", "/time-tracking?date=2026-05-04");
	});
});
```

- [ ] **Step 2: Run component tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/components/time-tracking/personal-workday-timeline.test.tsx`

Expected: FAIL with an import error for `./personal-workday-timeline`.

- [ ] **Step 3: Add the UI component**

Create `apps/webapp/src/components/time-tracking/personal-workday-timeline.tsx`:

```tsx
"use client";

import { IconAlertTriangle, IconCalendar, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/navigation";
import type { WorkdayTimelineItem, WorkdayTimelineResult } from "@/app/[locale]/(app)/time-tracking/workday-timeline.types";

interface PersonalWorkdayTimelineProps {
	result: WorkdayTimelineResult;
}

export function PersonalWorkdayTimeline({ result }: PersonalWorkdayTimelineProps) {
	const { t } = useTranslate();
	const selectedDate = result.success ? result.data.selectedDate : result.selectedDate;

	return (
		<Card className="@container/timeline">
			<CardHeader className="gap-4">
				<div className="flex flex-col gap-3 @md/timeline:flex-row @md/timeline:items-start @md/timeline:justify-between">
					<div>
						<CardTitle>{t("timeTracking.timeline.title", "Workday timeline")}</CardTitle>
						<CardDescription>{selectedDate.label}</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" asChild>
							<Link href={`/time-tracking?date=${selectedDate.previousDateKey}`} aria-label="Previous day">
								<IconChevronLeft className="h-4 w-4" />
							</Link>
						</Button>
						<Button variant="outline" size="sm" asChild>
							<Link href={`/time-tracking?date=${selectedDate.todayDateKey}`}>{t("timeTracking.timeline.today", "Today")}</Link>
						</Button>
						<Button variant="outline" size="sm" asChild>
							<Link href={`/time-tracking?date=${selectedDate.nextDateKey}`} aria-label="Next day">
								<IconChevronRight className="h-4 w-4" />
							</Link>
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{result.success ? <TimelineContent result={result} /> : <TimelineUnavailable />}
			</CardContent>
		</Card>
	);
}

function TimelineContent({ result }: { result: Extract<WorkdayTimelineResult, { success: true }> }) {
	const { t } = useTranslate();
	const { items, dayWarnings, hasRecordedActivity, hasScheduledContext } = result.data;

	if (items.length === 0) {
		return (
			<div className="rounded-lg border border-dashed p-4 text-sm">
				<p className="font-medium">{t("timeTracking.timeline.emptyTitle", "No activity recorded for this day.")}</p>
				<p className="mt-1 text-muted-foreground">
					{hasScheduledContext || hasRecordedActivity
						? t("timeTracking.timeline.emptyFiltered", "No timeline items match this selected day.")
						: t("timeTracking.timeline.emptyDescription", "There are no shifts, absences, or time entries for the selected day yet.")}
				</p>
			</div>
		);
	}

	return (
		<>
			{dayWarnings.length > 0 ? (
				<div className="space-y-2">
					{dayWarnings.map((warning) => (
						<Alert key={warning.id} variant={warning.severity === "danger" ? "destructive" : "default"}>
							<IconAlertTriangle className="h-4 w-4" />
							<AlertTitle>{warning.title}</AlertTitle>
							{warning.subtitle ? <AlertDescription>{warning.subtitle}</AlertDescription> : null}
							{warning.link ? (
								<Link className="mt-2 inline-flex text-sm font-medium underline-offset-4 hover:underline" href={warning.link.href}>
									{warning.link.label}
								</Link>
							) : null}
						</Alert>
					))}
				</div>
			) : null}

			<ol className="space-y-3">
				{items.map((item) => (
					<TimelineRow key={item.id} item={item} />
				))}
			</ol>
		</>
	);
}

function TimelineRow({ item }: { item: WorkdayTimelineItem }) {
	return (
		<li className="flex gap-3 rounded-lg border p-3">
			<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
				<IconCalendar className="h-4 w-4" />
			</div>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<p className="font-medium">{item.title}</p>
					{item.badge ? <Badge variant="secondary">{item.badge}</Badge> : null}
				</div>
				{item.startLabel || item.endLabel ? (
					<p className="text-sm tabular-nums text-muted-foreground">
						{item.startLabel}{item.endLabel ? ` - ${item.endLabel}` : ""}
					</p>
				) : null}
				{item.subtitle ? <p className="text-sm text-muted-foreground">{item.subtitle}</p> : null}
				{item.link ? (
					<Link className="inline-flex text-sm font-medium underline-offset-4 hover:underline" href={item.link.href}>
						{item.link.label}
					</Link>
				) : null}
			</div>
		</li>
	);
}

function TimelineUnavailable() {
	const { t } = useTranslate();

	return (
		<Alert>
			<AlertTitle>{t("timeTracking.timeline.unavailableTitle", "Timeline unavailable")}</AlertTitle>
			<AlertDescription>
				{t("timeTracking.timeline.unavailableDescription", "Clocking time still works. Try refreshing this view later.")}
			</AlertDescription>
		</Alert>
	);
}
```

- [ ] **Step 4: Run component tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/components/time-tracking/personal-workday-timeline.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit UI component**

```bash
git add apps/webapp/src/components/time-tracking/personal-workday-timeline.tsx apps/webapp/src/components/time-tracking/personal-workday-timeline.test.tsx
git commit -m "feat: add personal workday timeline UI"
```

## Task 5: Integrate Timeline Into Time Tracking Page

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/page-data.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx`

- [ ] **Step 1: Modify page data to accept selected date search params**

Update `apps/webapp/src/app/[locale]/(app)/time-tracking/page-data.ts` to this shape:

```ts
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { getWeekRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { normalizeWeekStartDay } from "@/lib/user-preferences/week-start";
import { getTranslate } from "@/tolgee/server";
import { getActiveWorkPeriod, getTimeSummary, getWorkPeriods } from "./actions";
import { getWorkdayTimelineData } from "./workday-timeline-data";

export interface TimeTrackingPageSearchParams {
	date?: string;
}

export async function getTimeTrackingPageData(searchParams: TimeTrackingPageSearchParams = {}) {
	const session = (await auth.api.getSession({ headers: await headers() }))!;

	const [currentEmployee, settings] = await Promise.all([
		db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		}),
		db.query.userSettings.findFirst({
			where: eq(userSettings.userId, session.user.id),
			columns: { timezone: true, weekStartDay: true },
		}),
	]);

	if (!currentEmployee) {
		return { session, currentEmployee: null } as const;
	}

	const timezone = settings?.timezone || "UTC";
	const weekStartDay = normalizeWeekStartDay(settings?.weekStartDay);
	const { start, end } = getWeekRangeInTimezone(new Date(), timezone, weekStartDay);
	const startDate = dateToDB(start)!;
	const endDate = dateToDB(end)!;

	const [activeWorkPeriod, workPeriods, summary, timelineResult, t] = await Promise.all([
		getActiveWorkPeriod(currentEmployee.id),
		getWorkPeriods(currentEmployee.id, startDate, endDate),
		getTimeSummary(currentEmployee.id, timezone, weekStartDay),
		getWorkdayTimelineData({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			timezone,
			dateParam: searchParams.date,
		}),
		getTranslate(),
	]);

	return {
		session,
		currentEmployee,
		timezone,
		activeWorkPeriod,
		workPeriods,
		summary,
		timelineResult,
		t,
	} as const;
}
```

- [ ] **Step 2: Modify the page to pass search params and render the timeline**

Update `apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx` to this shape:

```tsx
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ClockInOutWidget } from "@/components/time-tracking/clock-in-out-widget";
import { PersonalWorkdayTimeline } from "@/components/time-tracking/personal-workday-timeline";
import { TimeEntriesTable } from "@/components/time-tracking/time-entries-table";
import { WeeklySummaryCards } from "@/components/time-tracking/weekly-summary-cards";
import { getTimeTrackingPageData, type TimeTrackingPageSearchParams } from "./page-data";

interface TimeTrackingPageProps {
	searchParams: Promise<TimeTrackingPageSearchParams>;
}

export default async function TimeTrackingPage({ searchParams }: TimeTrackingPageProps) {
	await connection();

	const pageData = await getTimeTrackingPageData(await searchParams);

	if (!pageData.currentEmployee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="track time" />
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<ClockInOutWidget
					activeWorkPeriod={pageData.activeWorkPeriod}
					employeeName={pageData.session.user.name || pageData.t("common.employee", "Employee")}
				/>
			</div>

			<div className="px-4 lg:px-6">
				<PersonalWorkdayTimeline result={pageData.timelineResult} />
			</div>

			<WeeklySummaryCards summary={pageData.summary} />

			<div className="px-4 lg:px-6">
				<TimeEntriesTable
					workPeriods={pageData.workPeriods}
					hasManager={!!pageData.currentEmployee.managerId}
					employeeTimezone={pageData.timezone}
					employeeId={pageData.currentEmployee.id}
				/>
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Run focused tests**

Run: `pnpm --dir apps/webapp test src/app/[locale]/\(app\)/time-tracking/workday-timeline-date.test.ts src/app/[locale]/\(app\)/time-tracking/workday-timeline-normalize.test.ts src/app/[locale]/\(app\)/time-tracking/workday-timeline-data.test.ts src/components/time-tracking/personal-workday-timeline.test.tsx`

Expected: PASS.

- [ ] **Step 4: Commit page integration**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/time-tracking/page-data.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/page.tsx
git commit -m "feat: embed workday timeline on time tracking page"
```

## Task 6: Verification And Polish

**Files:**
- Modify only files created or changed in Tasks 1-5 if verification finds issues.

- [ ] **Step 1: Run the focused time-tracking tests**

Run: `pnpm --dir apps/webapp test src/app/[locale]/\(app\)/time-tracking src/components/time-tracking/personal-workday-timeline.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run the full webapp test suite**

Run: `pnpm --dir apps/webapp test`

Expected: PASS.

- [ ] **Step 3: Run the webapp build**

Run: `pnpm build:webapp`

Expected: PASS with `webapp:build` completing successfully.

- [ ] **Step 4: Check the diff for unrelated edits**

Run: `git diff --stat HEAD`

Expected: only Personal Workday Timeline files and intentional time-tracking integration files appear.

- [ ] **Step 5: Commit verification fixes if any were needed**

If Step 1, Step 2, or Step 3 required code changes, commit only those changes:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/time-tracking apps/webapp/src/components/time-tracking/personal-workday-timeline.tsx apps/webapp/src/components/time-tracking/personal-workday-timeline.test.tsx
git commit -m "fix: stabilize workday timeline"
```

If no fixes were needed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: Tasks cover day picker, employee-only placement, derived server model, org/employee filtering, shifts, work periods, absences, pending requests, warnings, unavailable state, and tests.
- Placeholder scan: The plan contains no placeholder markers or unspecified implementation steps.
- Type consistency: `WorkdayTimelineResult`, `WorkdayTimelineData`, `SelectedWorkdayDate`, and `getWorkdayTimelineData` are introduced before use and referenced consistently.
