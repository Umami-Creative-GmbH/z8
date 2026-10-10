import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { SubmissionCadence, SubmissionCadenceChange } from "./cadence";
import {
	deriveExpectedSubmissionPeriods,
	type ExpectedSubmissionPeriodFacts,
} from "./expected-periods";

const BERLIN = "Europe/Berlin";
const at = (value: string) => Temporal.Instant.from(value);
const change = (cadence: SubmissionCadence, changedAt: string): SubmissionCadenceChange => ({
	cadence,
	changedAt: at(changedAt),
});
const weeklyMonday: SubmissionCadence = { kind: "weekly", weekStartDay: "monday" };
const monthly: SubmissionCadence = { kind: "monthly" };

function facts(
	overrides: Partial<ExpectedSubmissionPeriodFacts> = {},
): ExpectedSubmissionPeriodFacts {
	return {
		cadenceHistory: [],
		timezone: BERLIN,
		employment: [{ startedAt: null, endedAt: null }],
		kioskOnly: false,
		approvedAbsences: [],
		publicHolidays: new Set(),
		nonWorkingDays: new Set(),
		...overrides,
	};
}

function ranges(input: ExpectedSubmissionPeriodFacts, from: string, to: string) {
	return deriveExpectedSubmissionPeriods(input, {
		from: parsePlainDate(from),
		to: parsePlainDate(to),
	}).map((period) => `${period.startDate}..${period.endDate}`);
}

describe("deriveExpectedSubmissionPeriods", () => {
	it("expects nothing while the cadence is off, the default", () => {
		expect(ranges(facts(), "2026-01-01", "2026-12-31")).toEqual([]);
		expect(
			ranges(
				facts({ cadenceHistory: [change({ kind: "off" }, "2026-01-01T00:00:00Z")] }),
				"2026-01-01",
				"2026-12-31",
			),
		).toEqual([]);
	});

	it("expects weekly periods from the first full week after switching on", () => {
		// Wednesday 2026-03-04: the week of 2026-03-02 has already started.
		const input = facts({ cadenceHistory: [change(weeklyMonday, "2026-03-04T10:00:00Z")] });
		expect(ranges(input, "2026-03-01", "2026-03-22")).toEqual([
			"2026-03-09..2026-03-15",
			"2026-03-16..2026-03-22",
		]);
	});

	it("expects calendar months from the first full month after switching on", () => {
		const input = facts({ cadenceHistory: [change(monthly, "2026-01-15T09:00:00Z")] });
		expect(ranges(input, "2026-01-01", "2026-03-31")).toEqual([
			"2026-02-01..2026-02-28",
			"2026-03-01..2026-03-31",
		]);
	});

	it("keeps the current period and expects no new ones after switching off", () => {
		const input = facts({
			cadenceHistory: [
				change(weeklyMonday, "2026-03-04T10:00:00Z"),
				// Wednesday of the week of 2026-03-16.
				change({ kind: "off" }, "2026-03-18T10:00:00Z"),
			],
		});
		expect(ranges(input, "2026-03-01", "2026-04-30")).toEqual([
			"2026-03-09..2026-03-15",
			"2026-03-16..2026-03-22",
		]);
	});

	it("changes from weekly to monthly at the next boundary both share", () => {
		const input = facts({
			cadenceHistory: [
				change(weeklyMonday, "2026-03-04T10:00:00Z"),
				change(monthly, "2026-03-20T10:00:00Z"),
			],
		});
		// 2026-06-01 is the first month start on a Monday after the change.
		expect(ranges(input, "2026-05-18", "2026-07-05")).toEqual([
			"2026-05-18..2026-05-24",
			"2026-05-25..2026-05-31",
			"2026-06-01..2026-06-30",
			"2026-07-01..2026-07-31",
		]);
	});

	it("changes from monthly to weekly at the next boundary both share", () => {
		const input = facts({
			cadenceHistory: [
				change(monthly, "2026-01-15T09:00:00Z"),
				change(weeklyMonday, "2026-06-10T09:00:00Z"),
			],
		});
		// 2027-02-01 is the first Monday that starts a month after 2026-06-10.
		expect(ranges(input, "2027-01-01", "2027-02-14")).toEqual([
			"2027-01-01..2027-01-31",
			"2027-02-01..2027-02-07",
			"2027-02-08..2027-02-14",
		]);
	});

	it("starts a new week start at the end of the current week, with a shortened first week", () => {
		const input = facts({
			cadenceHistory: [
				change(weeklyMonday, "2026-03-04T10:00:00Z"),
				change({ kind: "weekly", weekStartDay: "sunday" }, "2026-03-18T10:00:00Z"),
			],
		});
		expect(ranges(input, "2026-03-16", "2026-04-04")).toEqual([
			"2026-03-16..2026-03-22",
			"2026-03-23..2026-03-28",
			"2026-03-29..2026-04-04",
		]);
	});

	it("drops a change that had not taken effect when the cadence is changed again", () => {
		const input = facts({
			cadenceHistory: [
				change(weeklyMonday, "2026-03-04T10:00:00Z"),
				change(monthly, "2026-03-20T10:00:00Z"),
				change(weeklyMonday, "2026-04-10T10:00:00Z"),
			],
		});
		expect(ranges(input, "2026-05-25", "2026-06-14")).toEqual([
			"2026-05-25..2026-05-31",
			"2026-06-01..2026-06-07",
			"2026-06-08..2026-06-14",
		]);
	});

	it("clips the period of a mid-period join to the employment", () => {
		const input = facts({
			cadenceHistory: [change(weeklyMonday, "2026-03-04T10:00:00Z")],
			employment: [{ startedAt: at("2026-03-18T08:00:00Z"), endedAt: null }],
		});
		expect(ranges(input, "2026-03-09", "2026-03-29")).toEqual([
			"2026-03-18..2026-03-22",
			"2026-03-23..2026-03-29",
		]);
	});

	it("does not expect a departing employee's final period", () => {
		const input = facts({
			cadenceHistory: [change(weeklyMonday, "2026-03-04T10:00:00Z")],
			// Cutoff: the start of Thursday 2026-03-26 in Berlin.
			employment: [{ startedAt: null, endedAt: at("2026-03-25T23:00:00Z") }],
		});
		expect(ranges(input, "2026-03-09", "2026-04-12")).toEqual([
			"2026-03-09..2026-03-15",
			"2026-03-16..2026-03-22",
		]);
	});

	it("does not expect the final period even when the departure falls on its last day", () => {
		const input = facts({
			cadenceHistory: [change(weeklyMonday, "2026-03-04T10:00:00Z")],
			// Cutoff: the start of Monday 2026-03-30 in Berlin (after the switch to summer time).
			employment: [{ startedAt: null, endedAt: at("2026-03-29T22:00:00Z") }],
		});
		expect(ranges(input, "2026-03-09", "2026-04-12")).toEqual([
			"2026-03-09..2026-03-15",
			"2026-03-16..2026-03-22",
		]);
	});

	it("does not expect a month entirely covered by approved absences", () => {
		const input = facts({
			cadenceHistory: [change(monthly, "2025-12-15T09:00:00Z")],
			approvedAbsences: [
				{
					startDate: parsePlainDate("2026-02-01"),
					startPeriod: "full_day",
					endDate: parsePlainDate("2026-02-28"),
					endPeriod: "full_day",
				},
			],
		});
		expect(ranges(input, "2026-01-01", "2026-03-31")).toEqual([
			"2026-01-01..2026-01-31",
			"2026-03-01..2026-03-31",
		]);
	});

	it("still expects a month whose absences leave half a day", () => {
		const input = facts({
			cadenceHistory: [change(monthly, "2025-12-15T09:00:00Z")],
			approvedAbsences: [
				{
					startDate: parsePlainDate("2026-02-01"),
					startPeriod: "full_day",
					endDate: parsePlainDate("2026-02-27"),
					endPeriod: "full_day",
				},
				{
					startDate: parsePlainDate("2026-02-28"),
					startPeriod: "am",
					endDate: parsePlainDate("2026-02-28"),
					endPeriod: "am",
				},
			],
		});
		expect(ranges(input, "2026-02-01", "2026-02-28")).toEqual(["2026-02-01..2026-02-28"]);
	});

	it("keeps a week that spans two months as one period", () => {
		const input = facts({ cadenceHistory: [change(weeklyMonday, "2026-03-04T10:00:00Z")] });
		expect(ranges(input, "2026-04-01", "2026-04-12")).toEqual([
			"2026-03-30..2026-04-05",
			"2026-04-06..2026-04-12",
		]);
	});

	it("does not expect a week covered by holidays, absences and non-working days together", () => {
		const covered = {
			cadenceHistory: [change(weeklyMonday, "2026-03-04T10:00:00Z")],
			publicHolidays: new Set(["2026-04-06", "2026-04-07"]),
			nonWorkingDays: new Set(["2026-04-11", "2026-04-12"]),
		};
		const absence = (endDate: string) => ({
			startDate: parsePlainDate("2026-04-08"),
			startPeriod: "full_day" as const,
			endDate: parsePlainDate(endDate),
			endPeriod: "full_day" as const,
		});
		expect(
			ranges(
				facts({ ...covered, approvedAbsences: [absence("2026-04-10")] }),
				"2026-04-06",
				"2026-04-12",
			),
		).toEqual([]);
		expect(
			ranges(
				facts({ ...covered, approvedAbsences: [absence("2026-04-09")] }),
				"2026-04-06",
				"2026-04-12",
			),
		).toEqual(["2026-04-06..2026-04-12"]);
	});

	it("reads the switch-on instant in the employee's timezone", () => {
		// Monday 00:30 in Berlin, but still Sunday evening in New York.
		const history = [change(weeklyMonday, "2026-03-08T23:30:00Z")];
		expect(ranges(facts({ cadenceHistory: history }), "2026-03-01", "2026-03-22")).toEqual([
			"2026-03-16..2026-03-22",
		]);
		expect(
			ranges(
				facts({ cadenceHistory: history, timezone: "America/New_York" }),
				"2026-03-01",
				"2026-03-22",
			),
		).toEqual(["2026-03-09..2026-03-15", "2026-03-16..2026-03-22"]);
	});

	it("clips to employment by the employee's local days", () => {
		const history = [change(weeklyMonday, "2026-03-04T10:00:00Z")];
		// Monday 00:30 in Berlin, Sunday afternoon in Los Angeles.
		const employment = [{ startedAt: at("2026-03-15T23:30:00Z"), endedAt: null }];
		expect(
			ranges(facts({ cadenceHistory: history, employment }), "2026-03-09", "2026-03-22"),
		).toEqual(["2026-03-16..2026-03-22"]);
		expect(
			ranges(
				facts({ cadenceHistory: history, employment, timezone: "America/Los_Angeles" }),
				"2026-03-09",
				"2026-03-22",
			),
		).toEqual(["2026-03-15..2026-03-15", "2026-03-16..2026-03-22"]);
	});

	it("never expects a kiosk-only employee to submit", () => {
		const input = facts({
			cadenceHistory: [change(weeklyMonday, "2026-03-04T10:00:00Z")],
			kioskOnly: true,
		});
		expect(ranges(input, "2026-03-01", "2026-04-30")).toEqual([]);
	});

	it("returns the timezone and the whole cadence period with each clipped period", () => {
		const [period] = deriveExpectedSubmissionPeriods(
			facts({
				cadenceHistory: [change(weeklyMonday, "2026-03-04T10:00:00Z")],
				employment: [{ startedAt: at("2026-03-18T08:00:00Z"), endedAt: null }],
			}),
			{ from: parsePlainDate("2026-03-18"), to: parsePlainDate("2026-03-18") },
		);
		expect(period).toMatchObject({
			cadence: weeklyMonday,
			timezone: BERLIN,
			startDate: parsePlainDate("2026-03-18"),
			endDate: parsePlainDate("2026-03-22"),
			cadenceStartDate: parsePlainDate("2026-03-16"),
			cadenceEndDate: parsePlainDate("2026-03-22"),
		});
	});
});
