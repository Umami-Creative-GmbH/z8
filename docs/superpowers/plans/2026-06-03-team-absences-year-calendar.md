# Team Absences Year Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default year calendar to `/team/absences` that shows approved and pending absences for all accessible employees in the selected team and year.

**Architecture:** Add a manager-scoped calendar query beside the existing manager absence table query, with a compact display-specific result type. Add a dedicated client calendar component that renders a 12-month aggregate view and keeps the existing table below it.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, Luxon, Tolgee, Vitest, Testing Library, shadcn/ui primitives, `@tabler/icons-react`.

---

## File Structure

- Modify `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-types.ts` to add calendar entry/result types.
- Modify `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-action-helpers.ts` to add a pure year/date expansion helper for the calendar UI and tests.
- Modify `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts` to cover the pure calendar helper and exported server action contract.
- Modify `apps/webapp/src/app/[locale]/(app)/team/absences/actions.ts` to add `getManagerAbsenceCalendar` using the existing actor, team visibility, and organization scoping patterns.
- Create `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx` for the dedicated team year calendar component.
- Create `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx` for calendar rendering tests.
- Modify `apps/webapp/src/app/[locale]/(app)/team/absences/page.tsx` to load and render the calendar above `TeamAbsencesTable`.
- Modify `apps/webapp/src/app/[locale]/(app)/team/absences/page.test.tsx` to verify the calendar query receives year/team state and that table search/pagination state does not limit the calendar.

---

### Task 1: Add Calendar Types And Pure Date Grouping Helper

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-action-helpers.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add `buildManagerAbsenceCalendarDays` to the import list in `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`:

```ts
import {
	buildCanonicalAbsenceRecordValues,
	buildInaccessibleTeamAbsenceListResult,
	buildManagerAbsenceCalendarDays,
	buildManagerAbsenceRowAbsences,
	clampManagerAbsencePage,
	getAbsenceOverlapConflictMessage,
	isManagerAbsenceMetricSort,
	managerAbsenceAdvisoryLockKey,
	normalizeManagerAbsenceListParams,
	validateManagerAbsenceSickDetail,
	validateRecordAbsenceDateRange,
} from "./manager-absence-action-helpers";
```

Add these tests inside `describe("manager absence server action helpers", () => {` after the existing `buildManagerAbsenceRowAbsences` tests:

```ts
	it("groups team calendar absences by selected-year date and clips overlapping ranges", () => {
		const days = buildManagerAbsenceCalendarDays(
			[
				{
					id: "absence-overlap",
					employeeId: "employee-1",
					employeeName: "Ada Lovelace",
					startDate: "2025-12-30",
					startPeriod: "full_day",
					endDate: "2026-01-02",
					endPeriod: "full_day",
					status: "approved",
					category: { name: "Vacation", type: "vacation", color: "#3b82f6" },
				},
			],
			2026,
		);

		expect(days.map((day) => day.date)).toEqual(["2026-01-01", "2026-01-02"]);
		expect(days[0]).toMatchObject({
			date: "2026-01-01",
			approvedCount: 1,
			pendingCount: 0,
			totalCount: 1,
		});
		expect(days[0]?.entries[0]).toMatchObject({
			employeeName: "Ada Lovelace",
			status: "approved",
			category: { name: "Vacation" },
		});
	});

	it("groups approved and pending absences on the same team calendar day", () => {
		const days = buildManagerAbsenceCalendarDays(
			[
				{
					id: "absence-approved",
					employeeId: "employee-1",
					employeeName: "Ada Lovelace",
					startDate: "2026-06-10",
					startPeriod: "full_day",
					endDate: "2026-06-10",
					endPeriod: "full_day",
					status: "approved",
					category: { name: "Vacation", type: "vacation", color: null },
				},
				{
					id: "absence-pending",
					employeeId: "employee-2",
					employeeName: "Grace Hopper",
					startDate: "2026-06-10",
					startPeriod: "full_day",
					endDate: "2026-06-10",
					endPeriod: "full_day",
					status: "pending",
					category: { name: "Training", type: "other", color: "#f59e0b" },
				},
			],
			2026,
		);

		expect(days).toHaveLength(1);
		expect(days[0]).toMatchObject({
			date: "2026-06-10",
			approvedCount: 1,
			pendingCount: 1,
			totalCount: 2,
		});
		expect(days[0]?.entries.map((entry) => entry.employeeName)).toEqual([
			"Ada Lovelace",
			"Grace Hopper",
		]);
	});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts
```

Expected: FAIL with an export error for `buildManagerAbsenceCalendarDays`.

- [ ] **Step 3: Add calendar types**

In `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-types.ts`, add these interfaces after `ManagerAbsenceListResult`:

```ts
export interface ManagerAbsenceCalendarEntry {
	id: string;
	employeeId: string;
	employeeName: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	status: "approved" | "pending";
	category: {
		name: string;
		type: string;
		color: string | null;
	};
}

export interface ManagerAbsenceCalendarDay {
	date: string;
	approvedCount: number;
	pendingCount: number;
	totalCount: number;
	entries: ManagerAbsenceCalendarEntry[];
}

export interface ManagerAbsenceCalendarResult {
	year: number;
	teamId: string | null;
	entries: ManagerAbsenceCalendarEntry[];
}
```

- [ ] **Step 4: Add the pure grouping helper**

In `apps/webapp/src/app/[locale]/(app)/team/absences/manager-absence-action-helpers.ts`, update the type import:

```ts
import type {
	ManagerAbsenceCalendarDay,
	ManagerAbsenceCalendarEntry,
	ManagerAbsenceListParams,
	ManagerAbsenceListResult,
	ManagerAbsenceRowAbsence,
	ManagerAbsenceSortDirection,
	ManagerAbsenceSortKey,
	ManagerAbsenceTeamOption,
	RecordAbsenceForEmployeeInput,
} from "./manager-absence-types";
```

Add this helper after `buildManagerAbsenceRowAbsences`:

```ts
export function buildManagerAbsenceCalendarDays(
	entries: ManagerAbsenceCalendarEntry[],
	year: number,
): ManagerAbsenceCalendarDay[] {
	const yearStart = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: "utc" });
	const yearEnd = DateTime.fromObject({ year, month: 12, day: 31 }, { zone: "utc" });
	const daysByDate = new Map<string, ManagerAbsenceCalendarEntry[]>();

	for (const entry of entries) {
		const entryStart = DateTime.fromISO(entry.startDate, { zone: "utc" }).startOf("day");
		const entryEnd = DateTime.fromISO(entry.endDate, { zone: "utc" }).startOf("day");

		if (!entryStart.isValid || !entryEnd.isValid || entryEnd < yearStart || entryStart > yearEnd) {
			continue;
		}

		const clippedStart = entryStart < yearStart ? yearStart : entryStart;
		const clippedEnd = entryEnd > yearEnd ? yearEnd : entryEnd;

		for (let day = clippedStart; day <= clippedEnd; day = day.plus({ days: 1 })) {
			const date = day.toISODate();
			if (!date) {
				continue;
			}

			const existing = daysByDate.get(date) ?? [];
			existing.push(entry);
			daysByDate.set(date, existing);
		}
	}

	return [...daysByDate.entries()]
		.sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
		.map(([date, dayEntries]) => ({
			date,
			approvedCount: dayEntries.filter((entry) => entry.status === "approved").length,
			pendingCount: dayEntries.filter((entry) => entry.status === "pending").length,
			totalCount: dayEntries.length,
			entries: [...dayEntries].sort((entryA, entryB) =>
				entryA.employeeName.localeCompare(entryB.employeeName, undefined, { sensitivity: "base" }),
			),
		}));
}
```

- [ ] **Step 5: Run helper tests to verify pass**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts
```

Expected: PASS for `actions.test.ts`.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/team/absences/manager-absence-types.ts apps/webapp/src/app/[locale]/\(app\)/team/absences/manager-absence-action-helpers.ts apps/webapp/src/app/[locale]/\(app\)/team/absences/actions.test.ts
git commit -m "feat(absences): add team calendar grouping helper"
```

Expected: commit succeeds.

---

### Task 2: Add Manager-Scoped Calendar Server Query

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`

- [ ] **Step 1: Write failing export contract test**

In `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`, update the actions import:

```ts
import {
	getManagerAbsenceCalendar,
	getManagerAbsenceEmployees,
	recordAbsenceForEmployee,
} from "./actions";
```

Update the contract test:

```ts
describe("manager absence server action contracts", () => {
	it("exports the list, calendar, and record actions", () => {
		expect(typeof getManagerAbsenceEmployees).toBe("function");
		expect(typeof getManagerAbsenceCalendar).toBe("function");
		expect(typeof recordAbsenceForEmployee).toBe("function");
	});
});
```

- [ ] **Step 2: Run action tests to verify failure**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts
```

Expected: FAIL with an export error for `getManagerAbsenceCalendar`.

- [ ] **Step 3: Add server action imports and result type**

In `apps/webapp/src/app/[locale]/(app)/team/absences/actions.ts`, add `ManagerAbsenceCalendarResult` to the type import from `./manager-absence-types`:

```ts
import type {
	ManagerAbsenceActor,
	ManagerAbsenceCalendarResult,
	ManagerAbsenceEmployeeRow,
	ManagerAbsenceListResult,
	ManagerAbsenceSortDirection,
	ManagerAbsenceSortKey,
	ManagerAbsenceTeamOption,
	RecordAbsenceForEmployeeInput,
} from "./manager-absence-types";
```

- [ ] **Step 4: Add `getManagerAbsenceCalendar`**

Add this function after `getManagerAbsenceEmployees` in `actions.ts`:

```ts
export async function getManagerAbsenceCalendar(params: {
	year?: number;
	teamId?: string | null;
}): Promise<ServerActionResult<ManagerAbsenceCalendarResult>> {
	try {
		const actorResult = await resolveActor();
		if (!actorResult.success) return actorResult;

		const actor = actorResult.data;
		const normalized = normalizeManagerAbsenceListParams({
			year: params.year,
			teamId: params.teamId ?? null,
		});
		const teams = await selectVisibleTeams(actor);
		const accessibleTeamIds = new Set(teams.map((teamOption) => teamOption.id));

		if (normalized.teamId && !accessibleTeamIds.has(normalized.teamId)) {
			return {
				success: true,
				data: { year: normalized.year, teamId: null, entries: [] },
			};
		}

		const yearStart = `${normalized.year}-01-01`;
		const yearEnd = `${normalized.year}-12-31`;
		const employeeConditions = [
			eq(employee.organizationId, actor.organizationId),
			eq(employee.isActive, true),
		];

		if (normalized.teamId) {
			employeeConditions.push(eq(employee.teamId, normalized.teamId));
		}

		const rows =
			actor.role === "manager"
				? await db
						.select({
							id: absenceEntry.id,
							employeeId: absenceEntry.employeeId,
							employeeName: user.name,
							startDate: absenceEntry.startDate,
							startPeriod: absenceEntry.startPeriod,
							endDate: absenceEntry.endDate,
							endPeriod: absenceEntry.endPeriod,
							status: absenceEntry.status,
							categoryName: absenceCategory.name,
							categoryType: absenceCategory.type,
							categoryColor: absenceCategory.color,
						})
						.from(absenceEntry)
						.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
						.innerJoin(user, eq(employee.userId, user.id))
						.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
						.innerJoin(employeeManagers, eq(employeeManagers.employeeId, employee.id))
						.where(
							and(
								eq(absenceEntry.organizationId, actor.organizationId),
								...employeeConditions,
								eq(employeeManagers.managerId, actor.id),
								lte(absenceEntry.startDate, yearEnd),
								gte(absenceEntry.endDate, yearStart),
								or(eq(absenceEntry.status, "approved"), eq(absenceEntry.status, "pending")),
							),
						)
						.orderBy(asc(absenceEntry.startDate), asc(user.name))
				: await db
						.select({
							id: absenceEntry.id,
							employeeId: absenceEntry.employeeId,
							employeeName: user.name,
							startDate: absenceEntry.startDate,
							startPeriod: absenceEntry.startPeriod,
							endDate: absenceEntry.endDate,
							endPeriod: absenceEntry.endPeriod,
							status: absenceEntry.status,
							categoryName: absenceCategory.name,
							categoryType: absenceCategory.type,
							categoryColor: absenceCategory.color,
						})
						.from(absenceEntry)
						.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
						.innerJoin(user, eq(employee.userId, user.id))
						.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
						.where(
							and(
								eq(absenceEntry.organizationId, actor.organizationId),
								...employeeConditions,
								lte(absenceEntry.startDate, yearEnd),
								gte(absenceEntry.endDate, yearStart),
								or(eq(absenceEntry.status, "approved"), eq(absenceEntry.status, "pending")),
							),
						)
						.orderBy(asc(absenceEntry.startDate), asc(user.name));

		return {
			success: true,
			data: {
				year: normalized.year,
				teamId: normalized.teamId,
				entries: rows.map((row) => ({
					id: row.id,
					employeeId: row.employeeId,
					employeeName: row.employeeName,
					startDate: row.startDate,
					startPeriod: row.startPeriod,
					endDate: row.endDate,
					endPeriod: row.endPeriod,
					status: row.status as "approved" | "pending",
					category: {
						name: row.categoryName,
						type: row.categoryType,
						color: row.categoryColor,
					},
				})),
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load manager absence calendar");
		return { success: false, error: "Failed to load absence calendar", code: "UNKNOWN_ERROR" };
	}
}
```

- [ ] **Step 5: Run action tests to verify pass**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts
```

Expected: PASS for `actions.test.ts`.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/team/absences/actions.ts apps/webapp/src/app/[locale]/\(app\)/team/absences/actions.test.ts
git commit -m "feat(absences): add manager absence calendar query"
```

Expected: commit succeeds.

---

### Task 3: Add Team Year Calendar Component

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamAbsenceYearCalendar } from "./team-absence-year-calendar";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useWeekStartDay: () => "monday",
}));

describe("TeamAbsenceYearCalendar", () => {
	it("renders a year calendar with aggregate absence counts", () => {
		render(
			<TeamAbsenceYearCalendar
				data={{
					year: 2026,
					teamId: "team-1",
					entries: [
						{
							id: "absence-1",
							employeeId: "employee-1",
							employeeName: "Ada Lovelace",
							startDate: "2026-06-10",
							startPeriod: "full_day",
							endDate: "2026-06-10",
							endPeriod: "full_day",
							status: "approved",
							category: { name: "Vacation", type: "vacation", color: null },
						},
						{
							id: "absence-2",
							employeeId: "employee-2",
							employeeName: "Grace Hopper",
							startDate: "2026-06-10",
							startPeriod: "full_day",
							endDate: "2026-06-10",
							endPeriod: "full_day",
							status: "pending",
							category: { name: "Training", type: "other", color: "#f59e0b" },
						},
					],
				}}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Year calendar" })).toBeTruthy();
		expect(screen.getByText("2026")).toBeTruthy();
		expect(screen.getByText("June")).toBeTruthy();
		expect(screen.getByRole("button", { name: "June 10, 2026: 2 absent, 1 pending" })).toBeTruthy();
		expect(screen.getByText("2 absent")).toBeTruthy();
		expect(screen.getByText("1 pending")).toBeTruthy();
	});

	it("renders accessible hidden details for employee names, categories, and statuses", () => {
		render(
			<TeamAbsenceYearCalendar
				data={{
					year: 2026,
					teamId: null,
					entries: [
						{
							id: "absence-1",
							employeeId: "employee-1",
							employeeName: "Ada Lovelace",
							startDate: "2026-03-04",
							startPeriod: "full_day",
							endDate: "2026-03-04",
							endPeriod: "full_day",
							status: "approved",
							category: { name: "Vacation", type: "vacation", color: null },
						},
					],
				}}
			/>,
		);

		const details = screen.getByTestId("team-absence-calendar-details-2026-03-04");
		expect(within(details).getByText("Ada Lovelace")).toBeTruthy();
		expect(within(details).getByText("Vacation"));
		expect(within(details).getByText("Approved"));
	});
});
```

- [ ] **Step 2: Run component tests to verify failure**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/team/absences/team-absence-year-calendar.test.tsx
```

Expected: FAIL because `team-absence-year-calendar.tsx` does not exist.

- [ ] **Step 3: Create the calendar component**

Create `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx`:

```tsx
"use client";

import { DateTime } from "luxon";
import { useTranslate } from "@tolgee/react";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { cn } from "@/lib/utils";
import { buildManagerAbsenceCalendarDays } from "./manager-absence-action-helpers";
import type { ManagerAbsenceCalendarDay, ManagerAbsenceCalendarResult } from "./manager-absence-types";

type TeamAbsenceYearCalendarProps = {
	data: ManagerAbsenceCalendarResult;
};

const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function getMonthDays(year: number, month: number): DateTime[] {
	const firstDay = DateTime.fromObject({ year, month, day: 1 }, { zone: "utc" });
	return Array.from({ length: firstDay.daysInMonth ?? 0 }, (_value, dayIndex) =>
		firstDay.plus({ days: dayIndex }),
	);
}

function getFirstDayOffset(year: number, month: number, weekStartDay: WeekStartDay): number {
	const weekday = DateTime.fromObject({ year, month, day: 1 }, { zone: "utc" }).weekday;
	return weekStartDay === "monday" ? weekday - 1 : weekday % 7;
}

function formatDateLabel(date: DateTime): string {
	return date.toLocaleString({ month: "long", day: "numeric", year: "numeric" });
}

function buildDayLabel(day: ManagerAbsenceCalendarDay | undefined, date: DateTime): string {
	if (!day) {
		return formatDateLabel(date);
	}

	const pendingPart = day.pendingCount > 0 ? `, ${day.pendingCount} pending` : "";
	return `${formatDateLabel(date)}: ${day.totalCount} absent${pendingPart}`;
}

function TeamAbsenceMonth({
	month,
	year,
	monthName,
	weekdays,
	weekStartDay,
	daysByDate,
}: {
	month: number;
	year: number;
	monthName: string;
	weekdays: string[];
	weekStartDay: WeekStartDay;
	daysByDate: Map<string, ManagerAbsenceCalendarDay>;
}) {
	const { t } = useTranslate();
	const days = getMonthDays(year, month);
	const paddingDays = Array.from({ length: getFirstDayOffset(year, month, weekStartDay) }, (_, index) =>
		`padding-${month}-${index}`,
	);

	return (
		<section className="rounded-lg border bg-card p-2" aria-label={monthName}>
			<h3 className="mb-2 text-center font-medium text-sm">{monthName}</h3>
			<div className="mb-1 grid grid-cols-7 gap-0.5 text-center">
				{weekdays.map((weekday) => (
					<div key={weekday} className="font-medium text-[10px] text-muted-foreground">
						{weekday}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7 gap-0.5">
				{paddingDays.map((key) => (
					<div key={key} className="aspect-square" />
				))}
				{days.map((date) => {
					const dateKey = date.toISODate() ?? "";
					const day = daysByDate.get(dateKey);
					const hasApproved = (day?.approvedCount ?? 0) > 0;
					const hasPending = (day?.pendingCount ?? 0) > 0;
					const dayButton = (
						<button
							type="button"
							className={cn(
								"relative flex aspect-square flex-col items-center justify-center rounded-sm text-[10px] transition-colors hover:bg-accent",
								hasApproved && "bg-blue-100 text-blue-950 dark:bg-blue-900/30 dark:text-blue-100",
								hasPending && "ring-1 ring-yellow-500",
							)}
							aria-label={buildDayLabel(day, date)}
						>
							<span>{date.day}</span>
							{day ? <span className="font-semibold leading-none">{day.totalCount}</span> : null}
							{hasPending ? (
								<span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-yellow-500" />
							) : null}
						</button>
					);

					if (!day) {
						return <div key={dateKey}>{dayButton}</div>;
					}

					return (
						<Tooltip key={dateKey}>
							<TooltipTrigger asChild>{dayButton}</TooltipTrigger>
							<TooltipContent className="max-w-xs">
								<div className="space-y-2" data-testid={`team-absence-calendar-details-${dateKey}`}>
									<p className="font-medium">{buildDayLabel(day, date)}</p>
									{day.entries.map((entry) => (
										<div key={`${entry.id}-${dateKey}`} className="text-sm">
											<p className="font-medium">{entry.employeeName}</p>
											<p className="text-muted-foreground">
												{entry.category.name} · {entry.status === "pending" ? t("team.absences.calendar.pending", "Pending") : t("team.absences.calendar.approved", "Approved")}
											</p>
										</div>
									))}
								</div>
							</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
		</section>
	);
}

export function TeamAbsenceYearCalendar({ data }: TeamAbsenceYearCalendarProps) {
	const { t } = useTranslate();
	const weekStartDay = useWeekStartDay();
	const calendarDays = buildManagerAbsenceCalendarDays(data.entries, data.year);
	const daysByDate = new Map(calendarDays.map((day) => [day.date, day]));
	const monthNames = [
		t("common.months.january", "January"),
		t("common.months.february", "February"),
		t("common.months.march", "March"),
		t("common.months.april", "April"),
		t("common.months.may", "May"),
		t("common.months.june", "June"),
		t("common.months.july", "July"),
		t("common.months.august", "August"),
		t("common.months.september", "September"),
		t("common.months.october", "October"),
		t("common.months.november", "November"),
		t("common.months.december", "December"),
	];
	const sundayFirstWeekdays = [
		t("common.weekdays.su", "Su"),
		t("common.weekdays.mo", "Mo"),
		t("common.weekdays.tu", "Tu"),
		t("common.weekdays.we", "We"),
		t("common.weekdays.th", "Th"),
		t("common.weekdays.fr", "Fr"),
		t("common.weekdays.sa", "Sa"),
	];
	const weekdays = weekStartDay === "monday" ? [...sundayFirstWeekdays.slice(1), sundayFirstWeekdays[0]] : sundayFirstWeekdays;
	const totalAbsenceDays = calendarDays.reduce((sum, day) => sum + day.totalCount, 0);

	return (
		<section className="rounded-lg border bg-card p-4" aria-labelledby="team-absence-year-calendar-title">
			<div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h2 id="team-absence-year-calendar-title" className="font-semibold text-lg">
						{t("team.absences.calendar.title", "Year calendar")}
					</h2>
					<p className="text-muted-foreground text-sm">
						{t(
							"team.absences.calendar.description",
							"Approved and pending absences for the selected team and year.",
						)}
					</p>
				</div>
				<div className="text-right">
					<p className="font-semibold tabular-nums">{data.year}</p>
					<p className="text-muted-foreground text-sm">
						{t("team.absences.calendar.totalDays", "{count} absence days", {
							count: totalAbsenceDays,
						})}
					</p>
				</div>
			</div>

			<div className="mb-4 flex flex-wrap items-center gap-4 text-xs">
				<div className="flex items-center gap-1">
					<div className="size-3 rounded border border-blue-500 bg-blue-100 dark:bg-blue-900/30" />
					<span>{t("team.absences.calendar.legend.approved", "Approved")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="size-3 rounded border border-yellow-500" />
					<span>{t("team.absences.calendar.legend.pending", "Pending")}</span>
				</div>
			</div>

			<TooltipProvider delayDuration={150}>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
					{MONTH_NUMBERS.map((month) => (
						<TeamAbsenceMonth
							key={month}
							month={month}
							year={data.year}
							monthName={monthNames[month - 1] ?? String(month)}
							weekdays={weekdays}
							weekStartDay={weekStartDay}
							daysByDate={daysByDate}
						/>
					))}
				</div>
			</TooltipProvider>
		</section>
	);
}
```

- [ ] **Step 4: Run component tests to verify pass**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/team/absences/team-absence-year-calendar.test.tsx
```

Expected: PASS for `team-absence-year-calendar.test.tsx`.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/team/absences/team-absence-year-calendar.tsx apps/webapp/src/app/[locale]/\(app\)/team/absences/team-absence-year-calendar.test.tsx
git commit -m "feat(absences): add team absence year calendar"
```

Expected: commit succeeds.

---

### Task 4: Render Calendar On `/team/absences`

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/page.test.tsx`

- [ ] **Step 1: Write failing page tests**

In `apps/webapp/src/app/[locale]/(app)/team/absences/page.test.tsx`, add a calendar query mock below the existing list mock:

```ts
const getManagerAbsenceEmployees = vi.fn();
const getManagerAbsenceCalendar = vi.fn();
```

Update the `./actions` mock:

```ts
vi.mock("./actions", () => ({
	getManagerAbsenceEmployees,
	getManagerAbsenceCalendar,
}));
```

Update the table mock:

```tsx
vi.mock("./team-absences-table", () => ({
	TeamAbsencesTable: () => <div data-testid="team-absences-table" />,
}));
```

Add this calendar component mock after the table mock:

```tsx
vi.mock("./team-absence-year-calendar", () => ({
	TeamAbsenceYearCalendar: ({ data }: { data: { year: number; entries: unknown[] } }) => (
		<div data-testid="team-absence-year-calendar">{`${data.year}:${data.entries.length}`}</div>
	),
}));
```

Update `beforeEach` to reset and resolve the calendar mock:

```ts
	beforeEach(() => {
		getManagerAbsenceEmployees.mockReset();
		getManagerAbsenceCalendar.mockReset();
		getManagerAbsenceEmployees.mockResolvedValue({
			success: true,
			data: {
				rows: [],
				total: 0,
				page: 1,
				pageSize: 25,
				year: 2026,
				teamId: null,
				sort: "employee",
				direction: "asc",
				pageCount: 0,
				teams: [],
			},
		});
		getManagerAbsenceCalendar.mockResolvedValue({
			success: true,
			data: { year: 2026, teamId: null, entries: [] },
		});
	});
```

Add these tests after the existing URL state test:

```tsx
	it("passes only selected year and team state to the manager absence calendar", async () => {
		await TeamAbsencesPageContent({
			searchParams: Promise.resolve({
				search: " Ada ",
				page: "2",
				pageSize: "50",
				year: "2026",
				teamId: "team-1",
				sort: "remainingVacationDays",
				direction: "desc",
			}),
		});

		expect(getManagerAbsenceCalendar).toHaveBeenCalledWith({
			year: 2026,
			teamId: "team-1",
		});
	});

	it("renders the calendar above the existing table", async () => {
		const result = await TeamAbsencesPageContent({
			searchParams: Promise.resolve({ year: "2026" }),
		});

		expect(result).toBeTruthy();
		expect(getManagerAbsenceCalendar).toHaveBeenCalledWith({ year: 2026, teamId: undefined });
	});
```

- [ ] **Step 2: Run page tests to verify failure**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/team/absences/page.test.tsx
```

Expected: FAIL because `page.tsx` does not call `getManagerAbsenceCalendar` or render the calendar.

- [ ] **Step 3: Update page imports**

In `apps/webapp/src/app/[locale]/(app)/team/absences/page.tsx`, update imports:

```ts
import { getManagerAbsenceCalendar, getManagerAbsenceEmployees } from "./actions";
import { TeamAbsenceYearCalendar } from "./team-absence-year-calendar";
import { TeamAbsencesTable } from "./team-absences-table";
```

- [ ] **Step 4: Load calendar data in parallel with the table**

Replace this block in `page.tsx`:

```ts
	const [listResult, categories] = await Promise.all([
		getManagerAbsenceEmployees({
			search,
			page: parsePositiveInteger(params.page),
			pageSize: parsePositiveInteger(params.pageSize),
			year: parsePositiveInteger(params.year),
			teamId: params.teamId,
			sort: params.sort,
			direction: params.direction,
		}),
		getAbsenceCategories(currentEmployee.organizationId),
	]);
```

With:

```ts
	const selectedYear = parsePositiveInteger(params.year);
	const [listResult, calendarResult, categories] = await Promise.all([
		getManagerAbsenceEmployees({
			search,
			page: parsePositiveInteger(params.page),
			pageSize: parsePositiveInteger(params.pageSize),
			year: selectedYear,
			teamId: params.teamId,
			sort: params.sort,
			direction: params.direction,
		}),
		getManagerAbsenceCalendar({
			year: selectedYear,
			teamId: params.teamId,
		}),
		getAbsenceCategories(currentEmployee.organizationId),
	]);
```

- [ ] **Step 5: Render the calendar above the table with inline error fallback**

Replace the return section that currently renders only `TeamAbsencesTable` inside the `px-4 lg:px-6` container:

```tsx
			<div className="px-4 lg:px-6">
				<TeamAbsencesTable data={listResult.data} categories={categories} search={search} />
			</div>
```

With:

```tsx
			<div className="space-y-6 px-4 lg:px-6">
				{calendarResult.success ? (
					<TeamAbsenceYearCalendar data={calendarResult.data} />
				) : (
					<div className="rounded-lg border bg-card p-6 text-center">
						<h2 className="font-semibold">
							{t("team.absences.calendar.error.title", "Unable to load calendar")}
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{calendarResult.error ??
								t("team.absences.calendar.error.description", "Please try again in a moment.")}
						</p>
					</div>
				)}
				<TeamAbsencesTable data={listResult.data} categories={categories} search={search} />
			</div>
```

- [ ] **Step 6: Run page tests to verify pass**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/team/absences/page.test.tsx
```

Expected: PASS for `page.test.tsx`.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/team/absences/page.tsx apps/webapp/src/app/[locale]/\(app\)/team/absences/page.test.tsx
git commit -m "feat(absences): show team year calendar on absences page"
```

Expected: commit succeeds.

---

### Task 5: Final Verification

**Files:**
- Verify: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.test.ts`
- Verify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx`
- Verify: `apps/webapp/src/app/[locale]/(app)/team/absences/page.test.tsx`
- Verify: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.ts`
- Verify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx`
- Verify: `apps/webapp/src/app/[locale]/(app)/team/absences/page.tsx`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp test src/app/[locale]/\(app\)/team/absences/actions.test.ts src/app/[locale]/\(app\)/team/absences/team-absence-year-calendar.test.tsx src/app/[locale]/\(app\)/team/absences/page.test.tsx
```

Expected: PASS for all three test files.

- [ ] **Step 2: Run all webapp tests if focused tests pass**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS for the webapp Vitest suite.

- [ ] **Step 3: Run production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS with a successful production build.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- apps/webapp/src/app/[locale]/\(app\)/team/absences docs/superpowers/specs/2026-06-03-team-absences-year-calendar-design.md docs/superpowers/plans/2026-06-03-team-absences-year-calendar.md
```

Expected: diff contains only the team absences calendar implementation, tests, spec, and plan.

- [ ] **Step 5: Commit verification fixes if any were needed**

If Step 1, Step 2, or Step 3 required fixes, run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/team/absences
git commit -m "fix(absences): stabilize team absence calendar"
```

Expected: commit succeeds when fixes exist. If no fixes were needed, skip this commit step.

---

## Self-Review Notes

- Spec coverage: Tasks 2 and 4 cover server scoping, year/team query state, calendar rendering above the table, and inline calendar errors. Task 3 covers compact aggregate day indicators and readable details. Task 5 covers verification.
- Placeholder scan: The plan contains exact file paths, concrete code snippets, and concrete commands with expected outcomes.
- Type consistency: `ManagerAbsenceCalendarEntry`, `ManagerAbsenceCalendarDay`, and `ManagerAbsenceCalendarResult` are defined in Task 1 and reused consistently by Tasks 2 through 4.
