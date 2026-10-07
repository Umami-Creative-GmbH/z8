import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, DailyWorkRequirements } from "./types";
import {
	buildDailyActualMinutes,
	buildDailyWorkHoursSummaries,
	formatSignedMinutes,
	formatTimeHours,
} from "./work-hours-summary";

function workPeriod(date: string, durationMinutes: number): CalendarEvent {
	const start = new Date(`${date}T08:00:00.000Z`);
	return {
		id: `${date}-${durationMinutes}`,
		type: "work_period",
		date: start,
		endDate: new Date(start.getTime() + durationMinutes * 60_000),
		title: "Work",
		color: "#10b981",
		metadata: { durationMinutes, employeeName: "Ada" },
	};
}

function workPeriodAt(date: Date, durationMinutes: number): CalendarEvent {
	return {
		id: `${date.toISOString()}-${durationMinutes}`,
		type: "work_period",
		date,
		title: "Work",
		color: "#10b981",
		metadata: { durationMinutes, employeeName: "Ada" },
	};
}

describe("buildDailyActualMinutes", () => {
	it("groups work period dates by the selected calendar timezone", () => {
		const event = workPeriodAt(new Date("2026-06-01T02:00:00.000Z"), 120);
		event.endDate = new Date("2026-06-01T04:00:00.000Z");

		expect(buildDailyActualMinutes([event], "America/New_York")).toEqual({
			"2026-05-31": 120,
		});
	});

	it("splits a New York period across employee-local days after clipping", () => {
		const event = workPeriodAt(new Date("2026-05-02T03:30:00.000Z"), 120);
		event.endDate = new Date("2026-05-02T05:30:00.000Z");

		expect(
			buildDailyActualMinutes([event], "America/New_York", {
				start: new Date("2026-05-02T00:00:00.000Z"),
				endExclusive: new Date("2026-05-03T00:00:00.000Z"),
			}),
		).toEqual({
			"2026-05-01": 30,
			"2026-05-02": 90,
		});
	});

	it("uses elapsed minutes across Berlin DST boundaries", () => {
		const event = workPeriodAt(new Date("2026-03-28T23:30:00.000Z"), 120);
		event.endDate = new Date("2026-03-29T01:30:00.000Z");

		expect(buildDailyActualMinutes([event], "Europe/Berlin")).toEqual({
			"2026-03-29": 120,
		});
	});
});

describe("buildDailyWorkHoursSummaries", () => {
	const requirements: DailyWorkRequirements = {
		"2026-05-04": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
	};

	it("marks over when actual is above required", () => {
		const summaries = buildDailyWorkHoursSummaries({
			dailyRequirements: requirements,
			dailyActualMinutes: buildDailyActualMinutes([
				workPeriod("2026-05-04", 240),
				workPeriod("2026-05-04", 247),
			]),
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 487,
			includesLiveWork: false,
			requirement: { deltaMinutes: 7, status: "over" },
		});
	});

	it("marks under when actual is below required", () => {
		const summaries = buildDailyWorkHoursSummaries({
			dailyRequirements: requirements,
			dailyActualMinutes: { "2026-05-04": 449 },
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 449,
			requirement: { deltaMinutes: -31, status: "under" },
		});
	});

	it("marks missing when required time exists but no work was recorded", () => {
		const summaries = buildDailyWorkHoursSummaries({
			dailyRequirements: requirements,
			dailyActualMinutes: {},
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 0,
			requirement: { deltaMinutes: -480, status: "missing" },
		});
	});

	it("gives a day with work but no requirement a total without a requirement", () => {
		const summaries = buildDailyWorkHoursSummaries({
			dailyRequirements: {},
			dailyActualMinutes: { "2026-05-09": 150, "2026-05-10": 0 },
			liveWork: [{ startedAt: new Date("2026-05-11T10:00:00.000Z") }],
			timezone: "UTC",
			now: Temporal.Instant.from("2026-05-11T10:20:00Z"),
		});

		expect(Object.fromEntries(summaries)).toEqual({
			"2026-05-09": { actualMinutes: 150, includesLiveWork: false, requirement: null },
			"2026-05-11": { actualMinutes: 20, includesLiveWork: true, requirement: null },
		});
	});

	it("marks met when actual equals required", () => {
		const summaries = buildDailyWorkHoursSummaries({
			dailyRequirements: requirements,
			dailyActualMinutes: { "2026-05-04": 480 },
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 480,
			requirement: { deltaMinutes: 0, status: "met" },
		});
	});
});

describe("buildDailyWorkHoursSummaries with live work", () => {
	const standard = { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" };

	it("adds the elapsed whole minutes of live work to the day total", () => {
		const summaries = buildDailyWorkHoursSummaries({
			dailyRequirements: { "2026-05-04": standard },
			dailyActualMinutes: { "2026-05-04": 240 },
			liveWork: [{ startedAt: new Date("2026-05-04T12:00:00.000Z") }],
			timezone: "UTC",
			now: Temporal.Instant.from("2026-05-04T12:45:59Z"),
		});

		expect(summaries.get("2026-05-04")).toEqual({
			actualMinutes: 285,
			includesLiveWork: true,
			requirement: { ...standard, deltaMinutes: -195, status: "under" },
		});
	});

	it("marks the day as live as soon as live work starts, before a whole minute has elapsed", () => {
		const summaries = buildDailyWorkHoursSummaries({
			dailyRequirements: { "2026-05-04": standard },
			dailyActualMinutes: { "2026-05-04": 240 },
			liveWork: [{ startedAt: new Date("2026-05-04T12:00:00.000Z") }],
			timezone: "UTC",
			now: Temporal.Instant.from("2026-05-04T12:00:40Z"),
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 240,
			includesLiveWork: true,
		});
	});

	it("splits live work across Berlin local days at midnight", () => {
		// Clocked in 22:00 Berlin on 4 May, now 01:30 Berlin on 5 May.
		const summaries = buildDailyWorkHoursSummaries({
			dailyRequirements: { "2026-05-04": standard, "2026-05-05": standard },
			dailyActualMinutes: { "2026-05-04": 360 },
			liveWork: [{ startedAt: new Date("2026-05-04T20:00:00.000Z") }],
			timezone: "Europe/Berlin",
			now: Temporal.Instant.from("2026-05-04T23:30:00Z"),
		});

		expect(summaries.get("2026-05-04")).toMatchObject({
			actualMinutes: 480,
			includesLiveWork: true,
			requirement: { deltaMinutes: 0, status: "met" },
		});
		expect(summaries.get("2026-05-05")).toMatchObject({
			actualMinutes: 90,
			includesLiveWork: true,
		});
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
