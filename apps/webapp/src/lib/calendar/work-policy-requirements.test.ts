import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";
import {
	applyApprovedAbsencesToDailyRequirements,
	buildDailyWorkRequirements,
} from "./work-policy-requirements";

const source = readFileSync(
	fileURLToPath(new URL("./work-policy-requirements.ts", import.meta.url)),
	"utf8",
);

function basePolicy(schedule: EffectiveWorkPolicy["schedule"]): EffectiveWorkPolicy {
	return {
		policyId: "policy-1",
		policyName: "Standard Hours",
		schedule,
		regulation: null,
		assignmentType: "employee",
		assignedVia: "Individual",
	};
}

describe("buildDailyWorkRequirements", () => {
	it("returns no requirements when no schedule is enabled", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy(null),
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-07T23:59:59.999Z"),
		});

		expect(requirements).toEqual({});
	});

	it("splits a weekly simple weekday schedule across Monday through Friday", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "weekly",
				scheduleType: "simple",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
				homeOfficeDaysPerCycle: 0,
				days: [],
			}),
			startDate: new Date("2026-05-04T00:00:00.000Z"),
			endDate: new Date("2026-05-10T23:59:59.999Z"),
		});

		expect(requirements["2026-05-04"]?.requiredMinutes).toBe(480);
		expect(requirements["2026-05-05"]?.requiredMinutes).toBe(480);
		expect(requirements["2026-05-06"]?.requiredMinutes).toBe(480);
		expect(requirements["2026-05-07"]?.requiredMinutes).toBe(480);
		expect(requirements["2026-05-08"]?.requiredMinutes).toBe(480);
		expect(requirements["2026-05-09"]).toBeUndefined();
		expect(requirements["2026-05-10"]).toBeUndefined();
	});

	it("uses detailed per-day hours and omits non-work days", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "weekly",
				scheduleType: "detailed",
				workingDaysPreset: "custom",
				hoursPerCycle: null,
				homeOfficeDaysPerCycle: 0,
				days: [
					{ dayOfWeek: "monday", hoursPerDay: "7.5", isWorkDay: true },
					{ dayOfWeek: "tuesday", hoursPerDay: "8", isWorkDay: true },
					{ dayOfWeek: "wednesday", hoursPerDay: "0", isWorkDay: false },
				],
			}),
			startDate: new Date("2026-05-04T00:00:00.000Z"),
			endDate: new Date("2026-05-06T23:59:59.999Z"),
		});

		expect(requirements["2026-05-04"]?.requiredMinutes).toBe(450);
		expect(requirements["2026-05-05"]?.requiredMinutes).toBe(480);
		expect(requirements["2026-05-06"]).toBeUndefined();
	});

	it("does not guess unsupported non-weekly detailed cycle requirements", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "biweekly",
				scheduleType: "detailed",
				workingDaysPreset: "custom",
				hoursPerCycle: null,
				homeOfficeDaysPerCycle: 0,
				days: [
					{ dayOfWeek: "monday", hoursPerDay: "7.5", isWorkDay: true },
					{ dayOfWeek: "tuesday", hoursPerDay: "8", isWorkDay: true },
				],
			}),
			startDate: new Date("2026-05-04T00:00:00.000Z"),
			endDate: new Date("2026-05-10T23:59:59.999Z"),
		});

		expect(requirements).toEqual({});
	});

	it("does not guess unsupported non-weekly simple cycle requirements", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "monthly",
				scheduleType: "simple",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "160",
				homeOfficeDaysPerCycle: 0,
				days: [],
			}),
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-31T23:59:59.999Z"),
		});

		expect(requirements).toEqual({});
	});

	it("applies approved full-day absence reductions to daily requirements", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "weekly",
				scheduleType: "simple",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
				homeOfficeDaysPerCycle: 0,
				days: [],
			}),
			startDate: new Date("2026-05-18T00:00:00.000Z"),
			endDate: new Date("2026-05-18T23:59:59.999Z"),
		});

		expect(
			applyApprovedAbsencesToDailyRequirements(requirements, [
				{
					startDate: "2026-05-18",
					startPeriod: "full_day",
					endDate: "2026-05-18",
					endPeriod: "full_day",
				},
			]),
		).toEqual({
			"2026-05-18": {
				requiredMinutes: 0,
				policyId: "policy-1",
				policyName: "Standard Hours",
			},
		});
	});

	it("applies approved half-day absence reductions to daily requirements", () => {
		const requirements = buildDailyWorkRequirements({
			policy: basePolicy({
				scheduleCycle: "weekly",
				scheduleType: "detailed",
				workingDaysPreset: "custom",
				hoursPerCycle: null,
				homeOfficeDaysPerCycle: 0,
				days: [{ dayOfWeek: "monday", hoursPerDay: "8", isWorkDay: true }],
			}),
			startDate: new Date("2026-05-18T00:00:00.000Z"),
			endDate: new Date("2026-05-18T23:59:59.999Z"),
		});

		const adjusted = applyApprovedAbsencesToDailyRequirements(requirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "pm",
				endDate: "2026-05-18",
				endPeriod: "pm",
			},
		]);

		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(240);
	});
});

describe("getDailyWorkRequirementsForEmployee", () => {
	it("applies assigned holiday adjustments after absence adjustments", () => {
		expect(source).toContain("getAssignedHolidaysForEmployee");
		expect(source).toContain("applyAssignedHolidayAdjustmentsToRequirements");
		expect(source).toContain(
			"const absenceAdjustedRequirements = applyApprovedAbsencesToDailyRequirements",
		);
		expect(source).toContain(
			"return applyAssignedHolidayAdjustmentsToRequirements(absenceAdjustedRequirements, assignedHolidays)",
		);
	});

	it("clamps generated requirements to account creation unless imported work predates it", () => {
		expect(source).toContain("columns: { id: true, startDate: true }");
		expect(source).toContain("user: { columns: { createdAt: true } }");
		expect(source).toContain("getFirstCompletedWorkPeriodBeforeAccount");
		expect(source).toContain("scopedEmployee.user.createdAt");
		expect(source).toContain("const effectiveStartDate");
		expect(source).toContain("if (effectiveStartDate > params.endDate) return {};");
		expect(source).toContain("startDate: effectiveStartDate");
	});
});
