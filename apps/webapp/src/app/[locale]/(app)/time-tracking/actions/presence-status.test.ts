import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	calculatePresenceStatusCounts,
	calculatePresenceStatusSummary,
	expandApprovedHomeOfficeDates,
	getPresencePeriodBounds,
	getPresenceWorkDays,
	parsePresenceFixedDays,
	validatePresenceFixedDaysConfig,
} from "./presence-status";

const periodStart = DateTime.fromISO("2026-05-04T00:00:00.000Z", { zone: "utc" });
const periodEnd = DateTime.fromISO("2026-05-10T23:59:59.999Z", { zone: "utc" });

describe("calculatePresenceStatusCounts", () => {
	it("does not let an office day satisfy a different fixed on-site day", () => {
		const counts = calculatePresenceStatusCounts({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["friday"],
			workPeriods: [
				{
					startTime: new Date("2026-05-04T09:00:00.000Z"), // Monday
					workLocationType: "office",
				},
			],
		});

		expect(counts).toEqual({ actual: 0, required: 1 });
	});
});

describe("parsePresenceFixedDays", () => {
	it("returns valid configured weekdays", () => {
		expect(parsePresenceFixedDays('["monday","wednesday"]')).toEqual(["monday", "wednesday"]);
	});

	it("rejects malformed fixed day JSON", () => {
		expect(parsePresenceFixedDays("not-json")).toBeNull();
		expect(parsePresenceFixedDays('["monday","funday"]')).toBeNull();
	});
});

describe("validatePresenceFixedDaysConfig", () => {
	it("treats fixed policies without fixed weekdays as unavailable", () => {
		expect(validatePresenceFixedDaysConfig("fixed_days", null)).toBe(
			"Presence policy has no fixed office days configured.",
		);
		expect(validatePresenceFixedDaysConfig("fixed_days", [])).toBe(
			"Presence policy has no fixed office days configured.",
		);
	});

	it("allows configured fixed policies and flexible policies", () => {
		expect(validatePresenceFixedDaysConfig("fixed_days", ["monday"])).toBeNull();
		expect(validatePresenceFixedDaysConfig("minimum_count", null)).toBeNull();
	});
});

describe("getPresencePeriodBounds", () => {
	it("returns monthly bounds for the current month", () => {
		const bounds = getPresencePeriodBounds({
			period: "monthly",
			now: DateTime.fromISO("2026-05-21T12:00:00.000Z", { zone: "utc" }),
			weekStartDay: 1,
			timezone: "utc",
		});

		expect(bounds.start.toISO()).toBe("2026-05-01T00:00:00.000Z");
		expect(bounds.end.toISO()).toBe("2026-05-31T23:59:59.999Z");
	});

	it("returns a two-week range for biweekly policies", () => {
		const bounds = getPresencePeriodBounds({
			period: "biweekly",
			now: DateTime.fromISO("2026-05-21T12:00:00.000Z", { zone: "utc" }),
			weekStartDay: 1,
			timezone: "utc",
		});

		expect(bounds.start.toISO()).toBe("2026-05-11T00:00:00.000Z");
		expect(bounds.end.toISO()).toBe("2026-05-24T23:59:59.999Z");
		expect(bounds.end.diff(bounds.start, "days").days).toBeCloseTo(14, 3);
		expect(bounds.start.weekday).toBe(1);
	});
});

describe("getPresenceWorkDays", () => {
	it("uses detailed schedule workdays when available", () => {
		expect(
			getPresenceWorkDays([
				{ dayOfWeek: "monday", isWorkDay: true },
				{ dayOfWeek: "tuesday", isWorkDay: false },
				{ dayOfWeek: "wednesday", isWorkDay: true },
			]),
		).toEqual(["monday", "wednesday"]);
	});

	it("falls back to Monday through Friday", () => {
		expect(getPresenceWorkDays(null)).toEqual([
			"monday",
			"tuesday",
			"wednesday",
			"thursday",
			"friday",
		]);
	});
});

describe("calculatePresenceStatusSummary", () => {
	it("calculates flexible home-office days left and office days required", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 3,
			requiredOnsiteFixedDays: [],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-06T12:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [
				{ startTime: new Date("2026-05-04T09:00:00.000Z"), workLocationType: "office" },
				{ startTime: new Date("2026-05-05T09:00:00.000Z"), workLocationType: "home" },
			],
		});

		expect(summary).toMatchObject({
			available: true,
			homeOfficeDaysLeft: 1,
			officeDaysRequiredLeft: 2,
			officeDaysCompleted: 1,
			homeOfficeDaysUsed: 1,
			workingDaysRemaining: 3,
			requiredOfficeDays: 3,
		});
	});

	it("uses office requirement before flexible home-office allowance", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 3,
			requiredOnsiteFixedDays: [],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-08T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [
				{ startTime: new Date("2026-05-04T09:00:00.000Z"), workLocationType: "office" },
			],
		});

		expect(summary.homeOfficeDaysLeft).toBe(0);
		expect(summary.officeDaysRequiredLeft).toBe(2);
		expect(summary.workingDaysRemaining).toBe(1);
	});

	it("calculates fixed office weekdays and remaining home-office days", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["monday", "wednesday"],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-05T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [
				{ startTime: new Date("2026-05-04T09:00:00.000Z"), workLocationType: "office" },
			],
		});

		expect(summary).toMatchObject({
			homeOfficeDaysLeft: 3,
			officeDaysRequiredLeft: 1,
			requiredOfficeDays: 2,
			fixedOfficeDays: ["monday", "wednesday"],
		});
	});

	it("counts fixed office dates even when they are not scheduled workdays", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["sunday"],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-04T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [],
		});

		expect(summary.requiredOfficeDays).toBe(1);
		expect(summary.officeDaysRequiredLeft).toBe(1);
		expect(summary.homeOfficeDaysLeft).toBe(5);
	});

	it("keeps a fixed office day required when the employee works from home that day", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["wednesday"],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-06T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [{ startTime: new Date("2026-05-06T09:00:00.000Z"), workLocationType: "home" }],
		});

		expect(summary.officeDaysRequiredLeft).toBe(1);
	});

	it("does not count non-fixed office weekdays as completed fixed office days", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["monday", "wednesday"],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-06T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [
				{ startTime: new Date("2026-05-05T09:00:00.000Z"), workLocationType: "office" },
			],
		});

		expect(summary.officeDaysCompleted).toBe(0);
	});

	it("counts multiple work periods on one date once and keeps remote distinct from home", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 2,
			requiredOnsiteFixedDays: [],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-06T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [
				{ startTime: new Date("2026-05-04T09:00:00.000Z"), workLocationType: "office" },
				{ startTime: new Date("2026-05-04T13:00:00.000Z"), workLocationType: "office" },
				{ startTime: new Date("2026-05-05T09:00:00.000Z"), workLocationType: "remote" },
				{ startTime: new Date("2026-05-06T09:00:00.000Z"), workLocationType: "home" },
			],
		});

		expect(summary.officeDaysCompleted).toBe(1);
		expect(summary.homeOfficeDaysUsed).toBe(1);
	});

	it("does not require a fixed office day with an approved home-office exception", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["wednesday"],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-04T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [],
			approvedHomeOfficeDates: ["2026-05-06"],
		});

		expect(summary.requiredOfficeDays).toBe(0);
		expect(summary.officeDaysRequiredLeft).toBe(0);
		expect(summary.homeOfficeDaysLeft).toBe(5);
	});

	it("reduces flexible required office days by approved home-office exceptions", () => {
		const summary = calculatePresenceStatusSummary({
			presenceMode: "minimum_count",
			requiredOnsiteDays: 5,
			requiredOnsiteFixedDays: [],
			period: "weekly",
			periodStart,
			periodEnd,
			now: DateTime.fromISO("2026-05-04T08:00:00.000Z", { zone: "utc" }),
			timezone: "utc",
			workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			workPeriods: [],
			approvedHomeOfficeDates: ["2026-05-06", "2026-05-07"],
		});

		expect(summary.requiredOfficeDays).toBe(3);
		expect(summary.officeDaysRequiredLeft).toBe(3);
		expect(summary.homeOfficeDaysLeft).toBe(2);
	});
});

describe("expandApprovedHomeOfficeDates", () => {
	it("deduplicates and clips approved ranges to the presence period", () => {
		const dates = expandApprovedHomeOfficeDates({
			periodStart,
			periodEnd,
			timezone: "utc",
			entries: [
				{ startDate: "2026-05-03", endDate: "2026-05-06" },
				{ startDate: "2026-05-06", endDate: "2026-05-12" },
			],
		});

		expect(dates).toEqual([
			"2026-05-04",
			"2026-05-05",
			"2026-05-06",
			"2026-05-07",
			"2026-05-08",
			"2026-05-09",
			"2026-05-10",
		]);
	});

	it("ignores malformed approved ranges", () => {
		const dates = expandApprovedHomeOfficeDates({
			periodStart,
			periodEnd,
			timezone: "utc",
			entries: [
				{ startDate: "not-a-date", endDate: "2026-05-06" },
				{ startDate: "2026-05-08", endDate: "2026-05-07" },
			],
		});

		expect(dates).toEqual([]);
	});
});
