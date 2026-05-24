import { describe, expect, it, vi } from "vitest";
import {
	buildMonthWorkSummary,
	groupCalendarEventsByDate,
	totalWorkSummaries,
} from "./month-work-summary";
import type { CalendarEvent, DailyWorkHoursSummaries } from "./types";

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

function multiDayEvent(
	startDate: string,
	endDate: string,
	type: CalendarEvent["type"],
): CalendarEvent {
	return {
		...event(startDate, type),
		endDate: new Date(`${endDate}T00:00:00.000Z`),
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

	it("excludes future current-month days from week and month totals", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));

		try {
			const workHoursData: DailyWorkHoursSummaries = new Map([
				["2026-05-22", summary(480, 480)],
				["2026-05-24", summary(480, 120)],
				["2026-05-25", summary(480, 0)],
			]);

			const month = buildMonthWorkSummary({
				year: 2026,
				monthIndex: 4,
				weekStartDay: "monday",
				workHoursData,
			});

			expect(month.monthTotal).toMatchObject({
				requiredMinutes: 960,
				actualMinutes: 600,
				deltaMinutes: -360,
				status: "under",
			});
			expect(month.weeks[3]?.total).toMatchObject({
				requiredMinutes: 960,
				actualMinutes: 600,
				deltaMinutes: -360,
				status: "under",
			});
			expect(month.weeks[4]?.total).toBeNull();
		} finally {
			vi.useRealTimers();
		}
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

	it("exposes multi-day events on active month days they span", () => {
		const spanningEvent = multiDayEvent("2026-04-30", "2026-05-02", "absence");

		const month = buildMonthWorkSummary({
			year: 2026,
			monthIndex: 4,
			weekStartDay: "monday",
			workHoursData: new Map(),
			events: [spanningEvent],
		});

		const days = month.weeks.flatMap((week) => week.days);
		expect(days.find((day) => day.dateKey === "2026-05-01")?.events).toContain(spanningEvent);
		expect(days.find((day) => day.dateKey === "2026-05-02")?.events).toContain(spanningEvent);
	});
});

describe("totalWorkSummaries", () => {
	it("returns null when no summaries exist", () => {
		expect(totalWorkSummaries([])).toBeNull();
	});

	it("uses delta-based status for aggregate totals with zero actual minutes", () => {
		expect(totalWorkSummaries([summary(480, 0)])).toMatchObject({
			requiredMinutes: 480,
			actualMinutes: 0,
			deltaMinutes: -480,
			status: "under",
		});
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

	it("groups multi-day events under every date they span", () => {
		const spanningEvent = multiDayEvent("2026-04-30", "2026-05-02", "absence");

		const grouped = groupCalendarEventsByDate([spanningEvent]);

		expect(grouped.get("2026-04-30")).toContain(spanningEvent);
		expect(grouped.get("2026-05-01")).toContain(spanningEvent);
		expect(grouped.get("2026-05-02")).toContain(spanningEvent);
	});
});
