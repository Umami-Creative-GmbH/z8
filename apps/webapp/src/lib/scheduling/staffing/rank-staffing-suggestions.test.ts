import { describe, expect, it } from "vitest";
import { rankStaffingSuggestions } from "./rank-staffing-suggestions";
import type { StaffingSuggestion, StaffingWarning } from "./types";

function candidate(
	displayName: string,
	overrides: Partial<StaffingSuggestion> = {},
): StaffingSuggestion {
	return {
		employeeId: `id-${displayName}`,
		displayName,
		warnings: [],
		notes: [],
		reasons: [],
		requestedThisShift: false,
		remainingContractedMinutes: 600,
		...overrides,
	};
}

const missingSkill: StaffingWarning = {
	type: "missingRequiredSkill",
	skillId: "forklift",
	skillName: "Forklift",
};
const expiredSkill: StaffingWarning = {
	type: "expiredRequiredSkill",
	skillId: "first-aid",
	skillName: "First aid",
	expiresAt: "2026-10-01T00:00:00Z",
};
const compliance: StaffingWarning = {
	type: "compliance",
	findingType: "maxHours",
	finding: {
		type: "maxHours",
		employeeId: "x",
		day: "2026-10-09",
		totalMinutes: 660,
		maxDailyMinutes: 600,
	},
};
const pendingAbsence: StaffingWarning = {
	type: "pendingAbsence",
	categoryName: "Vacation",
	startDate: "2026-10-09",
	endDate: "2026-10-09",
};

function names(suggestions: StaffingSuggestion[]) {
	return suggestions.map((suggestion) => suggestion.displayName);
}

describe("rankStaffingSuggestions", () => {
	it("puts candidates without a required-skill warning first (key 1)", () => {
		const ranked = rankStaffingSuggestions([
			candidate("Missing", { warnings: [missingSkill], requestedThisShift: true }),
			candidate("Expired", { warnings: [expiredSkill], remainingContractedMinutes: 2400 }),
			candidate("Qualified", { warnings: [compliance], remainingContractedMinutes: 0 }),
		]);

		// Missing and expired weigh the same; the pickup request (key 3) breaks their tie.
		expect(names(ranked)).toEqual(["Qualified", "Missing", "Expired"]);
	});

	it("then puts candidates without a compliance warning first (key 2)", () => {
		const ranked = rankStaffingSuggestions([
			candidate("Compliance", { warnings: [compliance], requestedThisShift: true }),
			candidate("Clean", { remainingContractedMinutes: 0 }),
		]);

		expect(names(ranked)).toEqual(["Clean", "Compliance"]);
	});

	it("does not rank on a pending absence", () => {
		const ranked = rankStaffingSuggestions([
			candidate("Bea", { warnings: [pendingAbsence] }),
			candidate("Anna"),
		]);

		expect(names(ranked)).toEqual(["Anna", "Bea"]);
	});

	it("then puts candidates who requested the shift first (key 3)", () => {
		const ranked = rankStaffingSuggestions([
			candidate("Most hours", { remainingContractedMinutes: 2400 }),
			candidate("Requested", { requestedThisShift: true, remainingContractedMinutes: 60 }),
		]);

		expect(names(ranked)).toEqual(["Requested", "Most hours"]);
	});

	it("then sorts by most remaining contracted minutes (key 4)", () => {
		const ranked = rankStaffingSuggestions([
			candidate("Few", { remainingContractedMinutes: 120 }),
			candidate("Over", { remainingContractedMinutes: -60 }),
			candidate("Many", { remainingContractedMinutes: 1800 }),
		]);

		expect(names(ranked)).toEqual(["Many", "Few", "Over"]);
	});

	it("sorts candidates without a contracted target after everyone with one", () => {
		const ranked = rankStaffingSuggestions([
			candidate("Aaron", { remainingContractedMinutes: null }),
			candidate("Zoe", { remainingContractedMinutes: -480 }),
			candidate("Berta", { remainingContractedMinutes: null }),
		]);

		expect(names(ranked)).toEqual(["Zoe", "Aaron", "Berta"]);
	});

	it("finally sorts by display name (key 5)", () => {
		const ranked = rankStaffingSuggestions([
			candidate("Émile"),
			candidate("anna"),
			candidate("Bruno"),
		]);

		expect(names(ranked)).toEqual(["anna", "Bruno", "Émile"]);
	});

	it("applies the keys in order, not as a weighted score", () => {
		const ranked = rankStaffingSuggestions([
			candidate("A", { warnings: [missingSkill], requestedThisShift: true }),
			candidate("B", { warnings: [compliance], requestedThisShift: true }),
			candidate("C", { remainingContractedMinutes: null }),
			candidate("D", { remainingContractedMinutes: 30 }),
			candidate("E", { requestedThisShift: true, remainingContractedMinutes: null }),
		]);

		expect(names(ranked)).toEqual(["E", "D", "C", "B", "A"]);
	});

	it("does not change its input", () => {
		const input = [candidate("B"), candidate("A")];

		rankStaffingSuggestions(input);

		expect(names(input)).toEqual(["B", "A"]);
	});
});
