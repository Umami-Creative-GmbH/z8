# Calendar Month Work Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Schedule-X month grid with a custom month work-summary view showing daily, weekly, and monthly actual-vs-required policy hours.

**Architecture:** Keep existing calendar API/data flow unchanged: `CalendarView` already has `events` and policy-derived `workHoursData`. Add pure month-grid aggregation helpers, render a focused `MonthWorkSummaryView` for `viewMode === "month"`, and leave day/week/year behavior unchanged.

**Tech Stack:** React client components, Next.js app code, Luxon, Tolgee, existing Z8 UI/Tailwind utilities, Vitest, Testing Library, pnpm.

---

## File Map

- Create `apps/webapp/src/lib/calendar/month-work-summary.ts`: pure Luxon-based helpers for month weeks, week numbers, weekly totals, month totals, event grouping, and status formatting inputs.
- Create `apps/webapp/src/lib/calendar/month-work-summary.test.ts`: unit tests for month grid and aggregation behavior.
- Create `apps/webapp/src/components/calendar/month-work-summary-view.tsx`: custom month view UI with navigation header, view tabs, day cells, week-number column, weekly `Sum` column, and month summary card.
- Create `apps/webapp/src/components/calendar/month-work-summary-view.test.tsx`: component tests for daily/weekly/month totals and accessible labels.
- Modify `apps/webapp/src/components/calendar/calendar-view.tsx`: route `viewMode === "month"` to `MonthWorkSummaryView` instead of `ScheduleXWrapper` and pass month navigation callbacks.

---

### Task 1: Month Grid And Aggregation Helpers

**Files:**
- Create: `apps/webapp/src/lib/calendar/month-work-summary.ts`
- Create: `apps/webapp/src/lib/calendar/month-work-summary.test.ts`

- [ ] **Step 1: Write failing tests for month helper behavior**

Create `apps/webapp/src/lib/calendar/month-work-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CalendarEvent, DailyWorkHoursSummaries } from "./types";
import {
	buildMonthWorkSummary,
	groupCalendarEventsByDate,
	totalWorkSummaries,
} from "./month-work-summary";

function summary(requiredMinutes: number, actualMinutes: number) {
	const deltaMinutes = actualMinutes - requiredMinutes;
	return {
		requiredMinutes,
		actualMinutes,
		deltaMinutes,
		status:
			actualMinutes === 0
				? ("missing" as const)
				: actualMinutes >= requiredMinutes
					? deltaMinutes > 0
						? ("over" as const)
						: ("met" as const)
					: ("under" as const),
		policyId: "policy-1",
		policyName: "Standard",
	};
}

function event(date: string, type: CalendarEvent["type"]): CalendarEvent {
	return {
		id: `${type}-${date}`,
		type,
		date: new Date(`${date}T00:00:00.000Z`),
		title: type,
		color: "#10b981",
		metadata: {},
	};
}

describe("buildMonthWorkSummary", () => {
	it("builds Monday-start weeks with active-month days and week totals", () => {
		const workHoursData: DailyWorkHoursSummaries = new Map([
			["2026-05-04", summary(480, 606)],
			["2026-05-05", summary(360, 431)],
			["2026-05-06", summary(480, 560)],
			["2026-05-07", summary(480, 435)],
			["2026-05-08", summary(360, 305)],
		]);

		const month = buildMonthWorkSummary({
			year: 2026,
			monthIndex: 4,
			weekStartDay: "monday",
			workHoursData,
		});

		expect(month.weeks[0]?.days.map((day) => day.dateKey)).toEqual([
			"2026-04-27",
			"2026-04-28",
			"2026-04-29",
			"2026-04-30",
			"2026-05-01",
			"2026-05-02",
			"2026-05-03",
		]);
		expect(month.weeks[1]?.weekNumber).toBe(19);
		expect(month.weeks[1]?.total).toMatchObject({
			requiredMinutes: 2160,
			actualMinutes: 2337,
			deltaMinutes: 177,
			status: "over",
		});
		expect(month.monthTotal).toMatchObject({
			requiredMinutes: 2160,
			actualMinutes: 2337,
			deltaMinutes: 177,
			status: "over",
		});
	});

	it("aggregates only active-month required days for week and month totals", () => {
		const workHoursData: DailyWorkHoursSummaries = new Map([
			["2026-04-30", summary(480, 480)],
			["2026-05-01", summary(480, 300)],
			["2026-05-04", summary(480, 480)],
		]);

		const month = buildMonthWorkSummary({
			year: 2026,
			monthIndex: 4,
			weekStartDay: "monday",
			workHoursData,
		});

		expect(month.weeks[0]?.total).toMatchObject({
			requiredMinutes: 480,
			actualMinutes: 300,
			deltaMinutes: -180,
			status: "under",
		});
		expect(month.monthTotal).toMatchObject({
			requiredMinutes: 960,
			actualMinutes: 780,
			deltaMinutes: -180,
			status: "under",
		});
	});

	it("respects Sunday-start week layout", () => {
		const month = buildMonthWorkSummary({
			year: 2026,
			monthIndex: 4,
			weekStartDay: "sunday",
			workHoursData: new Map(),
		});

		expect(month.weeks[0]?.days.map((day) => day.dateKey)).toEqual([
			"2026-04-26",
			"2026-04-27",
			"2026-04-28",
			"2026-04-29",
			"2026-04-30",
			"2026-05-01",
			"2026-05-02",
		]);
	});
});

describe("totalWorkSummaries", () => {
	it("returns null when no summaries exist", () => {
		expect(totalWorkSummaries([])).toBeNull();
	});
});

describe("groupCalendarEventsByDate", () => {
	it("groups calendar events by date key", () => {
		const grouped = groupCalendarEventsByDate([
			event("2026-05-04", "holiday"),
			event("2026-05-04", "absence"),
			event("2026-05-05", "work_period"),
		]);

		expect(grouped.get("2026-05-04")?.map((item) => item.type)).toEqual(["holiday", "absence"]);
		expect(grouped.get("2026-05-05")?.map((item) => item.type)).toEqual(["work_period"]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter webapp test src/lib/calendar/month-work-summary.test.ts`

Expected: FAIL because `month-work-summary.ts` does not exist.

- [ ] **Step 3: Implement month helper**

Create `apps/webapp/src/lib/calendar/month-work-summary.ts`:

```ts
import { DateTime } from "luxon";
import type { CalendarEvent, DailyWorkHoursSummaries, DailyWorkHoursSummary } from "./types";
import { format } from "@/lib/datetime/luxon-utils";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";

export interface MonthWorkDay {
	date: DateTime;
	dateKey: string;
	dayNumber: number;
	isInMonth: boolean;
	workSummary?: DailyWorkHoursSummary;
}

export interface WorkPeriodTotal {
	requiredMinutes: number;
	actualMinutes: number;
	deltaMinutes: number;
	status: "met" | "over" | "under";
}

export interface MonthWorkWeek {
	weekNumber: number;
	days: MonthWorkDay[];
	total: WorkPeriodTotal | null;
}

export interface MonthWorkSummary {
	monthStart: DateTime;
	monthEnd: DateTime;
	weeks: MonthWorkWeek[];
	monthTotal: WorkPeriodTotal | null;
}

interface BuildMonthWorkSummaryOptions {
	year: number;
	monthIndex: number;
	weekStartDay: WeekStartDay;
	workHoursData: DailyWorkHoursSummaries;
}

function getGridStart(monthStart: DateTime, weekStartDay: WeekStartDay): DateTime {
	const targetWeekday = weekStartDay === "monday" ? 1 : 7;
	let cursor = monthStart.startOf("day");
	while (cursor.weekday !== targetWeekday) {
		cursor = cursor.minus({ days: 1 });
	}
	return cursor;
}

function getGridEnd(monthEnd: DateTime, weekStartDay: WeekStartDay): DateTime {
	const targetWeekday = weekStartDay === "monday" ? 7 : 6;
	let cursor = monthEnd.startOf("day");
	while (cursor.weekday !== targetWeekday) {
		cursor = cursor.plus({ days: 1 });
	}
	return cursor;
}

export function totalWorkSummaries(
	summaries: DailyWorkHoursSummary[],
): WorkPeriodTotal | null {
	if (summaries.length === 0) return null;

	const total = summaries.reduce(
		(acc, summary) => ({
			requiredMinutes: acc.requiredMinutes + summary.requiredMinutes,
			actualMinutes: acc.actualMinutes + summary.actualMinutes,
		}),
		{ requiredMinutes: 0, actualMinutes: 0 },
	);
	const deltaMinutes = total.actualMinutes - total.requiredMinutes;

	return {
		...total,
		deltaMinutes,
		status: deltaMinutes > 0 ? "over" : deltaMinutes === 0 ? "met" : "under",
	};
}

export function buildMonthWorkSummary({
	year,
	monthIndex,
	weekStartDay,
	workHoursData,
}: BuildMonthWorkSummaryOptions): MonthWorkSummary {
	const monthStart = DateTime.local(year, monthIndex + 1, 1).startOf("day");
	const monthEnd = monthStart.endOf("month").startOf("day");
	const gridStart = getGridStart(monthStart, weekStartDay);
	const gridEnd = getGridEnd(monthEnd, weekStartDay);
	const weeks: MonthWorkWeek[] = [];
	const monthSummaries: DailyWorkHoursSummary[] = [];

	for (let weekStart = gridStart; weekStart <= gridEnd; weekStart = weekStart.plus({ days: 7 })) {
		const days: MonthWorkDay[] = [];
		const weekSummaries: DailyWorkHoursSummary[] = [];

		for (let index = 0; index < 7; index++) {
			const date = weekStart.plus({ days: index });
			const dateKey = date.toFormat("yyyy-MM-dd");
			const isInMonth = date.month === monthStart.month;
			const workSummary = isInMonth ? workHoursData.get(dateKey) : undefined;

			if (workSummary) {
				weekSummaries.push(workSummary);
				monthSummaries.push(workSummary);
			}

			days.push({
				date,
				dateKey,
				dayNumber: date.day,
				isInMonth,
				workSummary,
			});
		}

		weeks.push({
			weekNumber: weekStart.weekNumber,
			days,
			total: totalWorkSummaries(weekSummaries),
		});
	}

	return {
		monthStart,
		monthEnd,
		weeks,
		monthTotal: totalWorkSummaries(monthSummaries),
	};
}

export function groupCalendarEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
	const grouped = new Map<string, CalendarEvent[]>();

	for (const event of events) {
		const dateKey = format(event.date, "yyyy-MM-dd");
		if (!grouped.has(dateKey)) grouped.set(dateKey, []);
		grouped.get(dateKey)?.push(event);
	}

	return grouped;
}
```

- [ ] **Step 4: Run helper tests**

Run: `pnpm --filter webapp test src/lib/calendar/month-work-summary.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/webapp/src/lib/calendar/month-work-summary.ts apps/webapp/src/lib/calendar/month-work-summary.test.ts
git commit -m "feat: add calendar month summary helpers"
```

---

### Task 2: Month Work Summary Component

**Files:**
- Create: `apps/webapp/src/components/calendar/month-work-summary-view.tsx`
- Create: `apps/webapp/src/components/calendar/month-work-summary-view.test.tsx`

- [ ] **Step 1: Write component tests**

Create `apps/webapp/src/components/calendar/month-work-summary-view.test.tsx`:

```tsx
/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent, DailyWorkHoursSummaries } from "@/lib/calendar/types";
import { MonthWorkSummaryView } from "./month-work-summary-view";

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) => {
			if (!params) return fallback;
			return Object.entries(params).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			);
		},
	}),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useWeekStartDay: () => "monday",
}));

function workSummary(requiredMinutes: number, actualMinutes: number) {
	const deltaMinutes = actualMinutes - requiredMinutes;
	return {
		requiredMinutes,
		actualMinutes,
		deltaMinutes,
		status: deltaMinutes > 0 ? ("over" as const) : deltaMinutes === 0 ? ("met" as const) : ("under" as const),
		policyId: "policy-1",
		policyName: "Standard",
	};
}

function holiday(date: string): CalendarEvent {
	return {
		id: `holiday-${date}`,
		type: "holiday",
		date: new Date(`${date}T00:00:00.000Z`),
		title: "Holiday",
		color: "#f59e0b",
		metadata: { categoryName: "Public", categoryType: "public", blocksTimeEntry: true, isRecurring: false },
	};
}

describe("MonthWorkSummaryView", () => {
	it("renders daily, weekly, and monthly work totals", () => {
		const workHoursData: DailyWorkHoursSummaries = new Map([
			["2026-05-04", workSummary(480, 606)],
			["2026-05-05", workSummary(360, 431)],
		]);

		render(
			<MonthWorkSummaryView
				monthDate={new Date("2026-05-15T00:00:00.000Z")}
				events={[holiday("2026-05-05")]}
				workHoursData={workHoursData}
				viewMode="month"
				onViewModeChange={vi.fn()}
				onMonthChange={vi.fn()}
				onDayClick={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);

		expect(screen.getByText("May 2026")).toBeTruthy();
		expect(screen.getByText("+2:06")).toBeTruthy();
		expect(screen.getByText("10:06 / 8:00")).toBeTruthy();
		expect(screen.getByText("+1:11")).toBeTruthy();
		expect(screen.getByText("7:11 / 6:00")).toBeTruthy();
		expect(screen.getAllByText("+3:17").length).toBeGreaterThanOrEqual(2);
		expect(screen.getAllByText("17:17 / 14:00").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText("Holiday")).toBeTruthy();
		expect(screen.getByLabelText(/May 4, 2026/)).toBeTruthy();
	});

	it("switches to day view when a day is clicked", () => {
		const onDayClick = vi.fn();
		render(
			<MonthWorkSummaryView
				monthDate={new Date("2026-05-15T00:00:00.000Z")}
				events={[]}
				workHoursData={new Map()}
				viewMode="month"
				onViewModeChange={vi.fn()}
				onMonthChange={vi.fn()}
				onDayClick={onDayClick}
				onRefresh={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByLabelText("May 4, 2026"));

		const clickedDate = DateTime.fromJSDate(onDayClick.mock.calls[0]?.[0]);
		expect(clickedDate.toObject()).toMatchObject({ year: 2026, month: 5, day: 4 });
	});

	it("supports month navigation and view tabs", () => {
		const onMonthChange = vi.fn();
		const onViewModeChange = vi.fn();
		render(
			<MonthWorkSummaryView
				monthDate={new Date("2026-05-15T00:00:00.000Z")}
				events={[]}
				workHoursData={new Map()}
				viewMode="month"
				onViewModeChange={onViewModeChange}
				onMonthChange={onMonthChange}
				onDayClick={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByLabelText("Previous"));
		fireEvent.click(screen.getByText("Week"));

		const previousMonth = DateTime.fromJSDate(onMonthChange.mock.calls[0]?.[0]);
		expect(previousMonth.toObject()).toMatchObject({ year: 2026, month: 4, day: 1 });
		expect(onViewModeChange).toHaveBeenCalledWith("week");
	});

	it("does not render work totals when no policy requirements exist", () => {
		render(
			<MonthWorkSummaryView
				monthDate={new Date("2026-05-15T00:00:00.000Z")}
				events={[]}
				workHoursData={new Map()}
				viewMode="month"
				onViewModeChange={vi.fn()}
				onMonthChange={vi.fn()}
				onDayClick={vi.fn()}
				onRefresh={vi.fn()}
			/>,
		);

		expect(screen.queryByText("0:00 / 0:00")).toBeNull();
		expect(screen.getByText("No policy hours in this month")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run component tests to verify failure**

Run: `pnpm --filter webapp test src/components/calendar/month-work-summary-view.test.tsx`

Expected: FAIL because `month-work-summary-view.tsx` does not exist.

- [ ] **Step 3: Implement month component**

Create `apps/webapp/src/components/calendar/month-work-summary-view.tsx`:

```tsx
"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useMemo } from "react";
import { IconChevronLeft, IconChevronRight, IconReload } from "@tabler/icons-react";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CalendarEvent, DailyWorkHoursSummaries, DailyWorkHoursSummary } from "@/lib/calendar/types";
import {
	buildMonthWorkSummary,
	groupCalendarEventsByDate,
	type MonthWorkDay,
	type WorkPeriodTotal,
} from "@/lib/calendar/month-work-summary";
import { formatSignedMinutes, formatTimeHours } from "@/lib/calendar/work-hours-summary";
import { cn } from "@/lib/utils";
import type { ViewMode } from "./schedule-x-calendar";

interface MonthWorkSummaryViewProps {
	monthDate: Date;
	events: CalendarEvent[];
	workHoursData: DailyWorkHoursSummaries;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	onMonthChange: (date: Date) => void;
	onDayClick: (date: Date) => void;
	onRefresh: () => void;
}

const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function getStatusClass(summary: DailyWorkHoursSummary | WorkPeriodTotal | null | undefined): string {
	if (!summary) return "text-muted-foreground";
	return summary.status === "under" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";
}

function WorkTotal({ total }: { total: DailyWorkHoursSummary | WorkPeriodTotal }) {
	return (
		<div className={cn("space-y-0.5 text-right tabular-nums", getStatusClass(total))}>
			<div className="font-semibold">{formatSignedMinutes(total.deltaMinutes).replace("h", "")}</div>
			<div className="text-xs font-medium">
				{formatTimeHours(total.actualMinutes).replace("h", "")} / {formatTimeHours(total.requiredMinutes).replace("h", "")}
			</div>
		</div>
	);
}

function eventBadgeClass(type: CalendarEvent["type"]): string {
	if (type === "holiday") return "bg-amber-100 text-amber-950 dark:bg-amber-900/30 dark:text-amber-100";
	if (type === "absence") return "bg-blue-100 text-blue-950 dark:bg-blue-900/30 dark:text-blue-100";
	return "bg-muted text-muted-foreground";
}

export function MonthWorkSummaryView({
	monthDate,
	events,
	workHoursData,
	viewMode,
	onViewModeChange,
	onMonthChange,
	onDayClick,
	onRefresh,
}: MonthWorkSummaryViewProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const weekStartDay = useWeekStartDay();
	const date = DateTime.fromJSDate(monthDate);
	const monthSummary = useMemo(
		() =>
			buildMonthWorkSummary({
				year: date.year,
				monthIndex: date.month - 1,
				weekStartDay,
				workHoursData,
			}),
		[date.year, date.month, weekStartDay, workHoursData],
	);
	const eventsByDate = useMemo(() => groupCalendarEventsByDate(events), [events]);
	const weekdayLabels = useMemo(() => {
		const labels = WEEKDAY_KEYS.map((day, index) =>
			DateTime.fromObject({ weekYear: 2026, weekNumber: 1, weekday: index + 1 })
				.setLocale(locale)
				.toFormat("ccc"),
		);
		return weekStartDay === "monday" ? labels : [labels[6], ...labels.slice(0, 6)];
	}, [locale, weekStartDay]);
	const dayLabelFormatter = useMemo(
		() => new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", year: "numeric" }),
		[locale],
	);
	const previousMonth = date.minus({ months: 1 }).startOf("month").toJSDate();
	const nextMonth = date.plus({ months: 1 }).startOf("month").toJSDate();

	function getDayLabel(day: MonthWorkDay, dayEvents: CalendarEvent[]): string {
		const dateLabel = dayLabelFormatter.format(day.date.toJSDate());
		if (!day.workSummary) return dateLabel;

		return t(
			"calendar.month.dayWorkLabel",
			"{date}, {actual} recorded, {required} required, {delta} delta, {eventCount} events",
			{
				date: dateLabel,
				actual: formatTimeHours(day.workSummary.actualMinutes),
				required: formatTimeHours(day.workSummary.requiredMinutes),
				delta: formatSignedMinutes(day.workSummary.deltaMinutes),
				eventCount: dayEvents.length,
			},
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
			<div className="flex items-center justify-between gap-4 pb-1">
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" onClick={() => onMonthChange(previousMonth)} aria-label={t("calendar.view.previous", "Previous")}>
						<IconChevronLeft className="size-4" />
					</Button>
					<Button variant="outline" size="icon" onClick={() => onMonthChange(nextMonth)} aria-label={t("calendar.view.next", "Next")}>
						<IconChevronRight className="size-4" />
					</Button>
					<Button variant="outline" size="sm" onClick={() => onMonthChange(new Date())}>
						{t("calendar.view.today", "Today")}
					</Button>
					<Button variant="outline" size="icon" onClick={onRefresh} aria-label={t("common.refresh", "Refresh")}>
						<IconReload className="size-4" />
					</Button>
				</div>
				<Tabs value={viewMode} onValueChange={(value) => onViewModeChange(value as ViewMode)}>
					<TabsList>
						<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
						<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
						<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
						<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="text-xl font-semibold text-foreground">
						{monthSummary.monthStart.setLocale(locale).toFormat("LLLL yyyy")}
					</h3>
					<p className="text-sm text-muted-foreground">
						{t("calendar.month.summaryDescription", "Daily, weekly, and monthly policy hours")}
					</p>
				</div>
				<div className="rounded-lg bg-muted px-5 py-3 text-right shadow-sm" aria-label={t("calendar.month.totalLabel", "Month total")}> 
					<div className="text-sm font-medium text-muted-foreground">{t("calendar.month.total", "Month total")}</div>
					{monthSummary.monthTotal ? (
						<WorkTotal total={monthSummary.monthTotal} />
					) : (
						<div className="text-sm text-muted-foreground">
							{t("calendar.month.noPolicyHours", "No policy hours in this month")}
						</div>
					)}
				</div>
			</div>

			<div className="min-h-0 overflow-auto rounded-xl border bg-card">
				<div className="min-w-[980px]">
					<div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))_150px] border-b bg-muted/40 text-sm font-medium text-muted-foreground">
						<div className="px-3 py-3">{t("calendar.month.weekNumber", "KW")}</div>
						{weekdayLabels.map((label) => (
							<div key={label} className="px-3 py-3 text-center">
								{label}
							</div>
						))}
						<div className="px-3 py-3 text-right">{t("calendar.month.sum", "Sum")}</div>
					</div>

					{monthSummary.weeks.map((week) => (
						<div
							key={`${week.weekNumber}-${week.days[0]?.dateKey}`}
							className="grid min-h-28 grid-cols-[64px_repeat(7,minmax(0,1fr))_150px] border-b last:border-b-0"
						>
							<div className="px-3 py-3 text-sm font-semibold text-muted-foreground">
								{week.weekNumber}
							</div>
							{week.days.map((day) => {
								const dayEvents = eventsByDate.get(day.dateKey) ?? [];
								return (
									<button
										key={day.dateKey}
										type="button"
										onClick={() => onDayClick(day.date.toJSDate())}
										aria-label={getDayLabel(day, dayEvents)}
										className={cn(
											"flex min-h-28 flex-col border-l px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
											!day.isInMonth && "bg-muted/20 text-muted-foreground",
										)}
									>
										<div className="flex items-center justify-between gap-2 text-sm font-medium">
											<span>{String(day.dayNumber).padStart(2, "0")}</span>
										</div>
										<div className="mt-auto space-y-1">
											{dayEvents.slice(0, 2).map((event) => (
												<span
													key={event.id}
													className={cn("inline-flex max-w-full rounded px-1.5 py-0.5 text-[11px] font-medium", eventBadgeClass(event.type))}
												>
													<span className="truncate">{event.title}</span>
												</span>
											))}
											{day.workSummary && <WorkTotal total={day.workSummary} />}
										</div>
									</button>
								);
							})}
							<div className="flex items-end justify-end border-l bg-muted/20 px-3 py-3">
								{week.total ? <WorkTotal total={week.total} /> : null}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Run component tests**

Run: `pnpm --filter webapp test src/components/calendar/month-work-summary-view.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run helper and component tests together**

Run: `pnpm --filter webapp test src/lib/calendar/month-work-summary.test.ts src/components/calendar/month-work-summary-view.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/webapp/src/components/calendar/month-work-summary-view.tsx apps/webapp/src/components/calendar/month-work-summary-view.test.tsx
git commit -m "feat: add calendar month work summary view"
```

---

### Task 3: Route Month Mode To Custom View

**Files:**
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`

- [ ] **Step 1: Update `CalendarView` to use month component**

In `apps/webapp/src/components/calendar/calendar-view.tsx`, add import:

```ts
import { MonthWorkSummaryView } from "./month-work-summary-view";
```

Replace the `viewMode === "year" ? ... : <ScheduleXWrapper ... />` conditional with a three-way branch:

```tsx
{viewMode === "year" ? (
	<YearCalendarView
		events={events}
		year={currentYear}
		viewMode={viewMode}
		onYearChange={setCurrentYear}
		onViewModeChange={setViewMode}
		onDayClick={handleDayClick}
		workHoursData={workHoursData}
	/>
) : viewMode === "month" ? (
	<MonthWorkSummaryView
		monthDate={currentMonth}
		events={events}
		workHoursData={workHoursData}
		viewMode={viewMode}
		onViewModeChange={setViewMode}
		onMonthChange={setCurrentMonth}
		onDayClick={handleDayClick}
		onRefresh={refetch}
	/>
) : (
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
)}
```

- [ ] **Step 2: Verify month navigation owns the bypassed toolbar behavior**

Confirm `MonthWorkSummaryView` includes the toolbar added in Task 2: previous month, next month, today, refresh, and the day/week/month/year tabs. `CalendarView` must pass `viewMode`, `onViewModeChange={setViewMode}`, `onMonthChange={setCurrentMonth}`, and `onRefresh={refetch}` exactly as shown in Step 1. Do not add a shared toolbar in this task.

- [ ] **Step 3: Run targeted tests**

Run: `pnpm --filter webapp test src/components/calendar/month-work-summary-view.test.tsx src/lib/calendar/month-work-summary.test.ts`

Expected: PASS.

- [ ] **Step 4: Run webapp build type check**

Run: `CI=true pnpm --filter webapp build`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/month-work-summary-view.tsx apps/webapp/src/components/calendar/month-work-summary-view.test.tsx
git commit -m "feat: use work summary calendar month view"
```

---

### Task 4: Final Verification

**Files:**
- Verify only; no planned source changes unless checks reveal issues.

- [ ] **Step 1: Run calendar-focused tests**

Run:

```bash
pnpm --filter webapp test src/app/api/calendar/events/route.test.ts src/lib/calendar/work-policy-requirements.test.ts src/lib/calendar/work-hours-summary.test.ts src/lib/calendar/month-work-summary.test.ts src/components/calendar/daily-requirement-strip.test.tsx src/components/calendar/month-work-summary-view.test.tsx src/lib/calendar/schedule-x-adapter.test.ts src/lib/calendar/schedule-x-locale.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run webapp build**

Run: `CI=true pnpm --filter webapp build`

Expected: PASS. Build warnings about `BETTER_AUTH_SECRET` fallback are acceptable if the command exits successfully.

- [ ] **Step 3: Inspect status and diff**

Run: `git status --short`

Expected: Only files from this plan are modified or the tree is clean after commits. Pre-existing unrelated changes in the main worktree must not be touched.

Run: `git diff --stat HEAD`

Expected: No uncommitted source diff if all task commits are complete.

- [ ] **Step 4: Commit verification fixes if needed**

If any verification command required fixes, commit only those fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize calendar month work summary"
```

If no fixes were needed, do not create an empty commit.
