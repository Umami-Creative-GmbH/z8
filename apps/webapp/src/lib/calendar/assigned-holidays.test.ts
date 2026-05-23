import { describe, expect, it } from "vitest";
import {
	type AssignedHolidayRange,
	applyAssignedHolidayAdjustmentsToRequirements,
	expandCustomAssignedHoliday,
	getAssignedHolidayDateKeys,
	getPresetHolidayExpansionYears,
	overlapsEffectiveWindow,
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

	it("expands yearly custom assigned holidays into the requested year", () => {
		const expanded = expandCustomAssignedHoliday(
			{
				id: "holiday-6",
				name: "Labor Day",
				organizationId: "org-1",
				startDate: new Date("2024-05-01T00:00:00.000Z"),
				endDate: new Date("2024-05-01T23:59:59.999Z"),
				categoryId: "category-1",
				description: "Recurring labor day",
				isActive: true,
				recurrenceType: "yearly",
				recurrenceRule: JSON.stringify({ month: 5, day: 1 }),
				recurrenceEndDate: null,
			},
			{
				startDate: new Date("2026-05-01T00:00:00.000Z"),
				endDate: new Date("2026-05-31T23:59:59.999Z"),
			},
		);

		expect(expanded).toHaveLength(1);
		expect(expanded[0]).toMatchObject({
			id: "holiday-6-2026",
			name: "Labor Day",
			categoryId: "category-1",
			description: "Recurring labor day",
		});
		expect(expanded[0]?.startDate.toISOString()).toBe("2026-05-01T00:00:00.000Z");
		expect(expanded[0]?.endDate.toISOString()).toBe("2026-05-01T23:59:59.999Z");
		expect(
			applyAssignedHolidayAdjustmentsToRequirements(
				{
					"2026-05-01": {
						requiredMinutes: 480,
						policyId: "policy-1",
						policyName: "Standard Hours",
					},
				},
				expanded,
			)["2026-05-01"]?.requiredMinutes,
		).toBe(0);
	});

	it("includes the previous UTC year when selecting preset holiday expansion years", () => {
		expect(
			getPresetHolidayExpansionYears(
				new Date("2027-01-01T00:00:00.000Z"),
				new Date("2027-01-31T23:59:59.999Z"),
			),
		).toEqual([2026, 2027]);
	});

	it("keeps an occurrence that overlaps an assignment effective window", () => {
		expect(
			overlapsEffectiveWindow(
				{
					id: "holiday-4",
					name: "New Year Shutdown",
					startDate: new Date("2026-12-31T00:00:00.000Z"),
					endDate: new Date("2027-01-01T23:59:59.999Z"),
				},
				{
					effectiveFrom: new Date("2027-01-01T00:00:00.000Z"),
					effectiveUntil: null,
				},
			),
		).toBe(true);
	});

	it("skips an occurrence outside an assignment effective window", () => {
		expect(
			overlapsEffectiveWindow(
				{
					id: "holiday-5",
					name: "Expired Assignment Holiday",
					startDate: new Date("2027-01-01T00:00:00.000Z"),
					endDate: new Date("2027-01-01T23:59:59.999Z"),
				},
				{
					effectiveFrom: null,
					effectiveUntil: new Date("2026-12-31T23:59:59.999Z"),
				},
			),
		).toBe(false);
	});
});
