import { describe, expect, it } from "vitest";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";
import { buildDailyWorkRequirements } from "./work-policy-requirements";

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
});
