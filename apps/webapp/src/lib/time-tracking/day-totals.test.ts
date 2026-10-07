import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import {
	buildDailyActualMinutes,
	buildDailyWorkHoursSummaries,
} from "@/lib/calendar/work-hours-summary";
import { localMonthRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, parseInstant } from "@/lib/datetime/temporal-core";
import { buildDayTotalBasis, type DayTotalWorkPeriod, summarizeDayTotals } from "./day-totals";

const BERLIN = "Europe/Berlin";

function completed(start: string, end: string, surchargeMinutes: number | null = null) {
	return { startTime: new Date(start), endTime: new Date(end), surchargeMinutes };
}

function live(start: string): DayTotalWorkPeriod {
	return { startTime: new Date(start), endTime: null, surchargeMinutes: null };
}

function summarize(periods: DayTotalWorkPeriod[], now: string, weekStartDay = "monday" as const) {
	const basis = buildDayTotalBasis({ periods, timezone: BERLIN, weekStartDay });
	return summarizeDayTotals(basis, parseInstant(now));
}

describe("day totals", () => {
	it("counts the elapsed whole minutes of live work in today, this week and this month", () => {
		// Wednesday 2026-10-07, 14:00 in Berlin: 240 completed minutes, live work for 45.
		const periods = [
			completed("2026-10-07T06:00:00Z", "2026-10-07T10:00:00Z"),
			live("2026-10-07T11:15:00Z"),
		];

		expect(summarize(periods, "2026-10-07T12:00:00Z")).toEqual({
			todayMinutes: 285,
			weekMinutes: 285,
			monthMinutes: 285,
		});
		expect(summarize(periods, "2026-10-07T12:01:30Z").todayMinutes).toBe(286);
	});

	it("splits live work at local midnight", () => {
		// 22:00 → 01:30 in Berlin (CEST), across into Wednesday 2026-10-07.
		const periods = [live("2026-10-06T20:00:00Z")];

		expect(summarize(periods, "2026-10-06T23:30:00Z")).toEqual({
			todayMinutes: 90,
			weekMinutes: 210,
			monthMinutes: 210,
		});
	});

	it("splits completed work at local midnight", () => {
		const periods = [completed("2026-10-06T20:00:00Z", "2026-10-06T23:30:00Z")];

		expect(summarize(periods, "2026-10-07T08:00:00Z")).toEqual({
			todayMinutes: 90,
			weekMinutes: 210,
			monthMinutes: 210,
		});
	});

	it("counts only the minutes inside this week", () => {
		// Sunday 22:00 → Monday 01:30; the Monday week starts at midnight.
		const periods = [completed("2026-10-04T20:00:00Z", "2026-10-04T23:30:00Z")];

		expect(summarize(periods, "2026-10-05T08:00:00Z", "monday")).toMatchObject({
			todayMinutes: 90,
			weekMinutes: 90,
			monthMinutes: 210,
		});
		expect(summarize(periods, "2026-10-05T08:00:00Z", "sunday").weekMinutes).toBe(210);
	});

	it("counts the in-month minutes of work that started in the previous month", () => {
		// 30 September 22:00 → 1 October 01:30 in Berlin.
		const completedAcross = [completed("2026-09-30T20:00:00Z", "2026-09-30T23:30:00Z")];
		const liveAcross = [live("2026-09-30T20:00:00Z")];

		expect(summarize(completedAcross, "2026-10-01T08:00:00Z")).toEqual({
			todayMinutes: 90,
			weekMinutes: 210,
			monthMinutes: 90,
		});
		expect(summarize(liveAcross, "2026-09-30T23:30:00Z")).toEqual({
			todayMinutes: 90,
			weekMinutes: 210,
			monthMinutes: 90,
		});
	});

	it("agrees with the calendar's day totals for the same work", () => {
		// Seconds make per-segment rounding matter; one period crosses the month boundary.
		const periods = [
			completed("2026-09-30T21:59:31Z", "2026-09-30T22:10:20Z"),
			completed("2026-10-01T06:00:10Z", "2026-10-01T09:59:40Z"),
			completed("2026-10-01T10:30:45Z", "2026-10-01T10:31:15Z"),
			live("2026-10-01T11:00:30Z"),
		];
		const now = "2026-10-01T12:20:00Z";
		const events: CalendarEvent[] = periods.map((period, index) => ({
			id: `period-${index}`,
			type: "work_period",
			date: period.startTime,
			endDate: period.endTime ?? undefined,
			title: "Work",
			color: "#10b981",
			metadata: {},
		}));
		const calendarDayTotals = new Map<string, number>();
		for (const month of ["2026-09-01", "2026-10-01"]) {
			const range = localMonthRange(month, BERLIN);
			const dailyActualMinutes = buildDailyActualMinutes(events, BERLIN, {
				start: dateFromInstant(range.start),
				endExclusive: dateFromInstant(range.endExclusive),
			});
			const summaries = buildDailyWorkHoursSummaries({
				dailyRequirements: {},
				dailyActualMinutes,
				liveWork: periods
					.filter((period) => !period.endTime)
					.map((p) => ({ startedAt: p.startTime })),
				timezone: BERLIN,
				now: parseInstant(now),
			});
			for (const [date, summary] of summaries) calendarDayTotals.set(date, summary.actualMinutes);
		}

		const summary = summarize(periods, now);
		expect(summary.todayMinutes).toBe(calendarDayTotals.get("2026-10-01"));
		expect(summary.monthMinutes).toBe(calendarDayTotals.get("2026-10-01"));
		expect(summary.weekMinutes).toBe(
			(calendarDayTotals.get("2026-09-30") ?? 0) + (calendarDayTotals.get("2026-10-01") ?? 0),
		);
		// 10 after midnight, 239.5 and 0.5 rounded up, 79 whole live minutes.
		expect(summary.todayMinutes).toBe(10 + 240 + 1 + 79);
	});

	it("credits all surcharge to the day its work period started", () => {
		const periods = [completed("2026-10-06T20:00:00Z", "2026-10-06T23:30:00Z", 60)];

		expect(summarize(periods, "2026-10-07T08:00:00Z")).toEqual({
			todayMinutes: 90,
			weekMinutes: 210,
			monthMinutes: 210,
			todaySurchargeMinutes: 0,
			weekSurchargeMinutes: 60,
			monthSurchargeMinutes: 60,
		});
	});
});
