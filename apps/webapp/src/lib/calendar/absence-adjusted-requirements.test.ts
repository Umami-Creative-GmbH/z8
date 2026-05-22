import { describe, expect, it } from "vitest";
import type { DailyWorkRequirements } from "./types";
import { applyAbsenceAdjustmentsToRequirements, getAbsenceDayFraction } from "./absence-adjusted-requirements";

const baseRequirements: DailyWorkRequirements = {
	"2026-05-18": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
	"2026-05-19": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
	"2026-05-20": { requiredMinutes: 480, policyId: "policy-1", policyName: "Standard" },
};

describe("getAbsenceDayFraction", () => {
	it("uses full day for same-day full-day absences", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-18",
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-18",
				endPeriod: "full_day",
			}),
		).toBe(1);
	});

	it("uses half day for same-day matching half-day absences", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-18",
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "am",
			}),
		).toBe(0.5);
	});

	it("uses full day for same-day am-to-pm absences", () => {
		expect(
			getAbsenceDayFraction({
				date: "2026-05-18",
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "pm",
			}),
		).toBe(1);
	});

	it("uses boundary half days and middle full days for multi-day absences", () => {
		const absence = {
			startDate: "2026-05-18",
			startPeriod: "pm" as const,
			endDate: "2026-05-20",
			endPeriod: "am" as const,
		};

		expect(getAbsenceDayFraction({ date: "2026-05-18", ...absence })).toBe(0.5);
		expect(getAbsenceDayFraction({ date: "2026-05-19", ...absence })).toBe(1);
		expect(getAbsenceDayFraction({ date: "2026-05-20", ...absence })).toBe(0.5);
	});
});

describe("applyAbsenceAdjustmentsToRequirements", () => {
	it("reduces approved full-day absences to zero required minutes", () => {
		const adjusted = applyAbsenceAdjustmentsToRequirements(baseRequirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-18",
				endPeriod: "full_day",
			},
		]);

		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(0);
		expect(adjusted["2026-05-19"]?.requiredMinutes).toBe(480);
	});

	it("reduces approved half-day absences by 50 percent", () => {
		const adjusted = applyAbsenceAdjustmentsToRequirements(baseRequirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "am",
			},
		]);

		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(240);
	});

	it("caps overlapping absence reductions at 100 percent", () => {
		const adjusted = applyAbsenceAdjustmentsToRequirements(baseRequirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "am",
				endDate: "2026-05-18",
				endPeriod: "am",
			},
			{
				startDate: "2026-05-18",
				startPeriod: "pm",
				endDate: "2026-05-18",
				endPeriod: "pm",
			},
			{
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-18",
				endPeriod: "full_day",
			},
		]);

		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(0);
	});

	it("does not mutate the original requirements object", () => {
		const adjusted = applyAbsenceAdjustmentsToRequirements(baseRequirements, [
			{
				startDate: "2026-05-18",
				startPeriod: "full_day",
				endDate: "2026-05-18",
				endPeriod: "full_day",
			},
		]);

		expect(baseRequirements["2026-05-18"]?.requiredMinutes).toBe(480);
		expect(adjusted["2026-05-18"]?.requiredMinutes).toBe(0);
	});
});
