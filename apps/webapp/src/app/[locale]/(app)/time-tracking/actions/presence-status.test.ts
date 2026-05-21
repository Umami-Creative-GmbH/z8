import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	calculatePresenceStatusCounts,
	calculatePresenceStatusSummary,
	parsePresenceFixedDays,
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
		expect(parsePresenceFixedDays('["monday","wednesday"]')).toEqual([
			"monday",
			"wednesday",
		]);
	});

	it("rejects malformed fixed day JSON", () => {
		expect(parsePresenceFixedDays("not-json")).toBeNull();
		expect(parsePresenceFixedDays('["monday","funday"]')).toBeNull();
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
			workPeriods: [
				{ startTime: new Date("2026-05-06T09:00:00.000Z"), workLocationType: "home" },
			],
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
});
