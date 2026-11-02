import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DayTotalWorkPeriod } from "./day-totals";
import { buildTimeKpiBasis, summarizeTimeKpis, type TimeKpiLimits } from "./time-kpis";

const BERLIN = "Europe/Berlin";

function completed(start: string, end: string, surchargeMinutes: number | null = null) {
	return { startTime: new Date(start), endTime: new Date(end), surchargeMinutes };
}

/** `minutes` of required time on every Monday to Friday from `first` through `last`. */
function weekdays(first: string, last: string, minutes = 480) {
	const required: Record<string, number> = {};
	for (let date = parsePlainDate(first); date.toString() <= last; date = date.add({ days: 1 })) {
		if (date.dayOfWeek <= 5) required[date.toString()] = minutes;
	}
	return required;
}

function kpis(
	periods: DayTotalWorkPeriod[],
	now: string,
	options: {
		requiredMinutesByDate?: Record<string, number>;
		limits?: TimeKpiLimits | null;
		weekStartDay?: "monday" | "sunday";
	} = {},
) {
	const basis = buildTimeKpiBasis({
		periods,
		timezone: BERLIN,
		weekStartDay: options.weekStartDay ?? "monday",
		requiredMinutesByDate: options.requiredMinutesByDate ?? {},
		limits: options.limits ?? null,
	});
	return summarizeTimeKpis(basis, parseInstant(now));
}

describe("time KPIs", () => {
	it("compares this week with last week up to the same point", () => {
		// Wednesday 2026-10-07, 14:00 in Berlin; 8h required on weekdays.
		const periods = [
			// Last week: Monday and Tuesday in full, Wednesday 08:00–16:00, Thursday.
			completed("2026-09-28T06:00:00Z", "2026-09-28T14:00:00Z"),
			completed("2026-09-29T06:00:00Z", "2026-09-29T14:00:00Z"),
			completed("2026-09-30T06:00:00Z", "2026-09-30T14:00:00Z"),
			completed("2026-10-01T06:00:00Z", "2026-10-01T14:00:00Z"),
			// This week: Monday, Tuesday, Wednesday 08:00–12:00.
			completed("2026-10-05T06:00:00Z", "2026-10-05T14:00:00Z"),
			completed("2026-10-06T06:00:00Z", "2026-10-06T14:00:00Z"),
			completed("2026-10-07T06:00:00Z", "2026-10-07T10:00:00Z"),
		];

		const { week } = kpis(periods, "2026-10-07T12:00:00Z", {
			requiredMinutesByDate: weekdays("2026-09-01", "2026-10-31"),
		});

		expect(week).toMatchObject({
			workedMinutes: 480 + 480 + 240,
			requiredMinutes: 5 * 480,
			// Monday and Tuesday in full, and 14 of Wednesday's 24 hours.
			requiredSoFarMinutes: 480 + 480 + 280,
			// Last Wednesday counts only until 14:00, and Thursday not at all.
			previous: { workedMinutes: 480 + 480 + 360, requiredMinutes: 480 + 480 + 280 },
		});
	});

	it("compares the whole of a shorter previous month once this month has passed its length", () => {
		// Tuesday 2026-03-31, 12:00 in Berlin; February 2026 has 28 days.
		const periods = [
			completed("2026-02-02T07:00:00Z", "2026-02-02T15:00:00Z"),
			// The last evening of February still counts.
			completed("2026-02-28T17:00:00Z", "2026-02-28T19:00:00Z"),
			completed("2026-03-02T07:00:00Z", "2026-03-02T15:00:00Z"),
		];

		const { month } = kpis(periods, "2026-03-31T10:00:00Z", {
			requiredMinutesByDate: weekdays("2026-02-01", "2026-03-31"),
		});

		expect(month).toMatchObject({
			workedMinutes: 480,
			// March 2026 has 22 weekdays, February 20.
			requiredMinutes: 22 * 480,
			requiredSoFarMinutes: 21 * 480 + 240,
			previous: { workedMinutes: 480 + 120, requiredMinutes: 20 * 480 },
		});
	});

	it("compares a month with the previous month up to the same day and time", () => {
		// Wednesday 2026-10-07, 14:00 in Berlin.
		const periods = [
			completed("2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z"),
			completed("2026-09-08T06:00:00Z", "2026-09-08T14:00:00Z"),
			completed("2026-10-01T06:00:00Z", "2026-10-01T14:00:00Z"),
		];

		const { month } = kpis(periods, "2026-10-07T12:00:00Z", {
			requiredMinutesByDate: weekdays("2026-09-01", "2026-10-31"),
		});

		expect(month).toMatchObject({
			workedMinutes: 480,
			requiredMinutes: 22 * 480,
			// 1, 2, 5 and 6 October in full, and 14 of the 7th's 24 hours.
			requiredSoFarMinutes: 4 * 480 + 280,
			// 1–4 September in full, and the 7th until 14:00.
			previous: { workedMinutes: 360, requiredMinutes: 4 * 480 + 280 },
		});
	});

	it("starts the week on the employee's week start day", () => {
		// Sunday 2026-10-04 and Monday 2026-10-05; now is Monday 14:00 in Berlin.
		const periods = [
			completed("2026-10-04T08:00:00Z", "2026-10-04T10:00:00Z"),
			completed("2026-10-05T06:00:00Z", "2026-10-05T08:00:00Z"),
		];

		expect(kpis(periods, "2026-10-05T12:00:00Z").week.workedMinutes).toBe(120);
		expect(
			kpis(periods, "2026-10-05T12:00:00Z", { weekStartDay: "sunday" }).week.days.map(
				(day) => day.date,
			)[0],
		).toBe("2026-10-04");
		expect(
			kpis(periods, "2026-10-05T12:00:00Z", { weekStartDay: "sunday" }).week.workedMinutes,
		).toBe(240);
	});

	it("lists every day of the period with its day total, required time and whether it is still ahead", () => {
		const periods = [completed("2026-10-05T06:00:00Z", "2026-10-05T14:30:00Z")];

		const { week, month } = kpis(periods, "2026-10-06T12:00:00Z", {
			requiredMinutesByDate: weekdays("2026-10-01", "2026-10-31"),
		});

		expect(week.days).toHaveLength(7);
		expect(week.days.slice(0, 3)).toEqual([
			{ date: "2026-10-05", workedMinutes: 510, requiredMinutes: 480, upcoming: false },
			{ date: "2026-10-06", workedMinutes: 0, requiredMinutes: 480, upcoming: false },
			{ date: "2026-10-07", workedMinutes: 0, requiredMinutes: 480, upcoming: true },
		]);
		expect(week.days[6]).toEqual({
			date: "2026-10-11",
			workedMinutes: 0,
			requiredMinutes: 0,
			upcoming: true,
		});
		expect(month.days).toHaveLength(31);
		expect(month.days[0]?.date).toBe("2026-10-01");
	});

	it("has no required time where the work policy requires none", () => {
		// Saturday 2026-10-10, with nothing required this week or month.
		const periods = [completed("2026-10-10T08:00:00Z", "2026-10-10T09:00:00Z")];

		const { today, week, month } = kpis(periods, "2026-10-10T12:00:00Z");

		expect(today).toMatchObject({ workedMinutes: 60, requiredMinutes: null, tone: "progress" });
		expect(week).toMatchObject({ requiredMinutes: null, requiredSoFarMinutes: null });
		expect(month).toMatchObject({ requiredMinutes: null, requiredSoFarMinutes: null });
		// Only today's required time decides today's bar: a weekday elsewhere in the week does not.
		const withWeekday = kpis(periods, "2026-10-10T12:00:00Z", {
			requiredMinutesByDate: { "2026-10-09": 480 },
		});
		expect(withWeekday.today.requiredMinutes).toBeNull();
		expect(withWeekday.week.requiredMinutes).toBe(480);
	});

	it("turns met once worked time reaches the required time", () => {
		const required = { requiredMinutesByDate: weekdays("2026-10-01", "2026-10-31") };

		expect(
			kpis(
				[completed("2026-10-07T06:00:00Z", "2026-10-07T13:59:00Z")],
				"2026-10-07T16:00:00Z",
				required,
			).today.tone,
		).toBe("progress");
		expect(
			kpis(
				[completed("2026-10-07T06:00:00Z", "2026-10-07T14:00:00Z")],
				"2026-10-07T16:00:00Z",
				required,
			).today.tone,
		).toBe("met");
	});

	it("warns close to and past the work policy's daily and weekly limits", () => {
		const limits = { maxDailyMinutes: 600, maxWeeklyMinutes: 2880, alertBeforeLimitMinutes: 30 };
		const today = (minutes: number) =>
			kpis(
				[
					completed(
						"2026-10-07T04:00:00Z",
						new Date(Date.parse("2026-10-07T04:00:00Z") + minutes * 60_000).toISOString(),
					),
				],
				"2026-10-07T20:00:00Z",
				{ limits },
			).today.tone;

		expect(today(569)).toBe("progress");
		expect(today(570)).toBe("near_limit");
		expect(today(600)).toBe("near_limit");
		expect(today(601)).toBe("over_limit");

		// Monday to Thursday at 12h each is 48h: the weekly limit, so not over it.
		const longWeek = ["05", "06", "07", "08"].map((day) =>
			completed(`2026-10-${day}T04:00:00Z`, `2026-10-${day}T16:00:00Z`),
		);
		const { week, month } = kpis(longWeek, "2026-10-08T20:00:00Z", { limits });
		expect(week.tone).toBe("near_limit");
		expect(month.tone).toBe("progress");
		const pastWeekly = [...longWeek, completed("2026-10-09T04:00:00Z", "2026-10-09T04:01:00Z")];
		expect(kpis(pastWeekly, "2026-10-09T20:00:00Z", { limits }).week.tone).toBe("over_limit");
	});

	it("has no limit warnings without a configured limit", () => {
		const periods = [completed("2026-10-07T04:00:00Z", "2026-10-07T18:00:00Z")];

		expect(
			kpis(periods, "2026-10-07T20:00:00Z", {
				limits: { maxDailyMinutes: null, maxWeeklyMinutes: null, alertBeforeLimitMinutes: 30 },
			}).today.tone,
		).toBe("progress");
	});

	it("advances today, the week, its last day and the tone as live work runs", () => {
		const limits = { maxDailyMinutes: 600, maxWeeklyMinutes: null, alertBeforeLimitMinutes: 30 };
		// Live since 06:00 in Berlin on Wednesday 2026-10-07.
		const periods: DayTotalWorkPeriod[] = [
			{ startTime: new Date("2026-10-07T04:00:00Z"), endTime: null, surchargeMinutes: null },
		];

		const at = (now: string) => kpis(periods, now, { limits });

		expect(at("2026-10-07T13:29:00Z").today).toMatchObject({
			workedMinutes: 569,
			tone: "progress",
		});
		const later = at("2026-10-07T13:30:00Z");
		expect(later.today).toMatchObject({ workedMinutes: 570, tone: "near_limit" });
		expect(later.week.workedMinutes).toBe(570);
		expect(later.week.days[2]).toMatchObject({ date: "2026-10-07", workedMinutes: 570 });
	});

	it("counts live work that started last week only up to the same point", () => {
		// Still clocked in since last Wednesday 06:00 in Berlin; now is this Wednesday 08:00.
		const periods: DayTotalWorkPeriod[] = [
			{ startTime: new Date("2026-09-30T04:00:00Z"), endTime: null, surchargeMinutes: null },
		];

		const { week } = kpis(periods, "2026-10-07T06:00:00Z");

		// Last week up to Wednesday 08:00 holds its 06:00–08:00.
		expect(week.previous.workedMinutes).toBe(120);
	});

	it("shows each period's surcharge on the day its work started", () => {
		// Friday 2026-10-02: the week began in September.
		const periods = [
			completed("2026-09-30T20:00:00Z", "2026-09-30T23:30:00Z", 60),
			completed("2026-10-01T18:00:00Z", "2026-10-01T20:00:00Z", 30),
			completed("2026-10-02T06:00:00Z", "2026-10-02T08:00:00Z", 15),
		];

		const { today, week, month } = kpis(periods, "2026-10-02T12:00:00Z");

		expect(today.surchargeMinutes).toBe(15);
		expect(week.surchargeMinutes).toBe(60 + 30 + 15);
		expect(month.surchargeMinutes).toBe(30 + 15);
	});
});
