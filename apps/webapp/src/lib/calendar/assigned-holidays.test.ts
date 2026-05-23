import { describe, expect, it } from "vitest";
import {
	type AssignedHolidayRange,
	applyAssignedHolidayAdjustmentsToRequirements,
	getAssignedHolidayDateKeys,
} from "./assigned-holidays";

const singleDayHoliday: AssignedHolidayRange = {
	id: "holiday-1",
	name: "Labor Day",
	startDate: new Date("2026-05-01T00:00:00.000Z"),
	endDate: new Date("2026-05-01T23:59:59.999Z"),
};

describe("assigned holiday requirement adjustments", () => {
	it("sets required minutes to zero on an assigned holiday", () => {
		expect(
			applyAssignedHolidayAdjustmentsToRequirements(
				{
					"2026-05-01": {
						requiredMinutes: 480,
						policyId: "policy-1",
						policyName: "Standard Hours",
					},
				},
				[singleDayHoliday],
			),
		).toEqual({
			"2026-05-01": {
				requiredMinutes: 0,
				policyId: "policy-1",
				policyName: "Standard Hours",
			},
		});
	});

	it("zeros every overlapping required date for a multi-day holiday", () => {
		const adjusted = applyAssignedHolidayAdjustmentsToRequirements(
			{
				"2026-05-04": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard Hours" },
				"2026-05-05": { requiredMinutes: 360, policyId: "policy-1", policyName: "Standard Hours" },
				"2026-05-06": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard Hours" },
			},
			[
				{
					id: "holiday-2",
					name: "Company Shutdown",
					startDate: new Date("2026-05-04T00:00:00.000Z"),
					endDate: new Date("2026-05-05T23:59:59.999Z"),
				},
			],
		);

		expect(adjusted["2026-05-04"]?.requiredMinutes).toBe(0);
		expect(adjusted["2026-05-05"]?.requiredMinutes).toBe(0);
		expect(adjusted["2026-05-06"]?.requiredMinutes).toBe(480);
	});

	it("does not create requirement entries for holiday dates without policy requirements", () => {
		expect(applyAssignedHolidayAdjustmentsToRequirements({}, [singleDayHoliday])).toEqual({});
	});

	it("expands assigned holiday ranges into UTC date keys", () => {
		expect(
			getAssignedHolidayDateKeys([
				{
					id: "holiday-3",
					name: "Two Day Holiday",
					startDate: new Date("2026-12-24T00:00:00.000Z"),
					endDate: new Date("2026-12-25T23:59:59.999Z"),
				},
			]),
		).toEqual(new Set(["2026-12-24", "2026-12-25"]));
	});
});
