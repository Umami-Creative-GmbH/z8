import { describe, expect, it } from "vitest";
import { buildStaffingSuggestion } from "./build-staffing-suggestion";

const base = {
	employeeId: "employee-1",
	displayName: "Anna Berg",
	skills: { warnings: [], notes: [], reasons: [] },
	complianceFindings: [],
	restRuleApplies: false,
	pendingAbsences: [],
	requestedThisShift: false,
	plannedMinutes: 1920,
	targetMinutes: 2400,
};

describe("buildStaffingSuggestion", () => {
	it("shows the planned hours against the target and the remaining minutes", () => {
		expect(buildStaffingSuggestion(base)).toEqual({
			employeeId: "employee-1",
			displayName: "Anna Berg",
			warnings: [],
			notes: [],
			reasons: [{ type: "plannedHours", plannedMinutes: 1920, targetMinutes: 2400 }],
			requestedThisShift: false,
			remainingContractedMinutes: 480,
		});
	});

	it("marks a candidate without a usable target", () => {
		const suggestion = buildStaffingSuggestion({ ...base, targetMinutes: null });

		expect(suggestion.remainingContractedMinutes).toBeNull();
		expect(suggestion.reasons).toEqual([{ type: "noContractedTarget" }]);
	});

	it("says the rest period is fine only when a rest rule applies and holds", () => {
		expect(buildStaffingSuggestion({ ...base, restRuleApplies: true }).reasons).toContainEqual({
			type: "restPeriodOk",
		});

		const finding = {
			type: "restTime" as const,
			employeeId: "employee-1",
			fromEndIso: "2026-10-08T23:00:00.000+02:00",
			toStartIso: "2026-10-09T06:00:00.000+02:00",
			restMinutes: 420,
			minRestPeriodMinutes: 660,
		};
		const shortRest = buildStaffingSuggestion({
			...base,
			restRuleApplies: true,
			complianceFindings: [finding],
		});
		expect(shortRest.reasons).not.toContainEqual({ type: "restPeriodOk" });
		expect(shortRest.warnings).toEqual([{ type: "compliance", findingType: "restTime", finding }]);
	});

	it("orders skills, compliance and pending absence warnings and marks a pickup request", () => {
		const suggestion = buildStaffingSuggestion({
			...base,
			skills: {
				warnings: [{ type: "missingRequiredSkill", skillId: "s", skillName: "Forklift" }],
				notes: [{ type: "missingPreferredSkill", skillId: "p", skillName: "French" }],
				reasons: [{ type: "skillsHeld", skillNames: ["Hygiene"] }],
			},
			pendingAbsences: [
				{
					startDate: "2026-10-09",
					startPeriod: "full_day",
					endDate: "2026-10-09",
					endPeriod: "full_day",
					categoryName: "Vacation",
				},
			],
			requestedThisShift: true,
		});

		expect(suggestion.warnings).toEqual([
			{ type: "missingRequiredSkill", skillId: "s", skillName: "Forklift" },
			{
				type: "pendingAbsence",
				categoryName: "Vacation",
				startDate: "2026-10-09",
				endDate: "2026-10-09",
			},
		]);
		expect(suggestion.notes).toEqual([
			{ type: "missingPreferredSkill", skillId: "p", skillName: "French" },
		]);
		expect(suggestion.reasons).toEqual([
			{ type: "skillsHeld", skillNames: ["Hygiene"] },
			{ type: "plannedHours", plannedMinutes: 1920, targetMinutes: 2400 },
			{ type: "requestedThisShift" },
		]);
		expect(suggestion.requestedThisShift).toBe(true);
	});
});
