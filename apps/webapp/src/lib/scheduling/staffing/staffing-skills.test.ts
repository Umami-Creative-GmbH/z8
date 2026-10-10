import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { assessStaffingSkills, resolveSkillRequirements } from "./staffing-skills";

// The shift runs 2026-10-20 06:00-14:00 UTC.
const shiftEnd = Temporal.Instant.from("2026-10-20T14:00:00Z");

describe("resolveSkillRequirements", () => {
	it("unites subarea and template requirements, with required winning", () => {
		expect(
			resolveSkillRequirements([
				{ skillId: "forklift", skillName: "Forklift", isRequired: false },
				{ skillId: "hygiene", skillName: "Hygiene", isRequired: true },
				{ skillId: "forklift", skillName: "Forklift", isRequired: true },
				{ skillId: "hygiene", skillName: "Hygiene", isRequired: false },
				{ skillId: "french", skillName: "French", isRequired: false },
			]),
		).toEqual([
			{ skillId: "forklift", skillName: "Forklift", isRequired: true },
			{ skillId: "hygiene", skillName: "Hygiene", isRequired: true },
			{ skillId: "french", skillName: "French", isRequired: false },
		]);
	});
});

describe("assessStaffingSkills", () => {
	const requirements = [
		{ skillId: "forklift", skillName: "Forklift", isRequired: true },
		{ skillId: "first-aid", skillName: "First aid", isRequired: true },
		{ skillId: "french", skillName: "French", isRequired: false },
	];

	it("lists the required skills held as a reason", () => {
		const result = assessStaffingSkills({
			requirements,
			held: [
				{ skillId: "forklift", expiresAt: null },
				{ skillId: "first-aid", expiresAt: new Date("2027-01-01T00:00:00Z") },
				{ skillId: "french", expiresAt: null },
			],
			shiftEnd,
		});

		expect(result).toEqual({
			warnings: [],
			notes: [],
			reasons: [{ type: "skillsHeld", skillNames: ["Forklift", "First aid", "French"] }],
		});
	});

	it("warns about a required skill the employee lacks", () => {
		const result = assessStaffingSkills({
			requirements,
			held: [{ skillId: "first-aid", expiresAt: null }],
			shiftEnd,
		});

		expect(result.warnings).toEqual([
			{ type: "missingRequiredSkill", skillId: "forklift", skillName: "Forklift" },
		]);
		expect(result.notes).toEqual([
			{ type: "missingPreferredSkill", skillId: "french", skillName: "French" },
		]);
		expect(result.reasons).toEqual([{ type: "skillsHeld", skillNames: ["First aid"] }]);
	});

	it("warns about a certificate that is valid today but expired by the shift", () => {
		const result = assessStaffingSkills({
			requirements,
			held: [
				{ skillId: "forklift", expiresAt: null },
				// Valid until 2026-10-15, after today (2026-10-10) and before the shift (2026-10-20).
				{ skillId: "first-aid", expiresAt: new Date("2026-10-15T00:00:00Z") },
				{ skillId: "french", expiresAt: null },
			],
			shiftEnd,
		});

		expect(result.warnings).toEqual([
			{
				type: "expiredRequiredSkill",
				skillId: "first-aid",
				skillName: "First aid",
				expiresAt: "2026-10-15T00:00:00Z",
			},
		]);
	});

	it("counts a certificate expiring during the shift as expired", () => {
		const result = assessStaffingSkills({
			requirements: [requirements[1]],
			held: [{ skillId: "first-aid", expiresAt: new Date("2026-10-20T10:00:00Z") }],
			shiftEnd,
		});

		expect(result.warnings.map((warning) => warning.type)).toEqual(["expiredRequiredSkill"]);
	});

	it("keeps a certificate valid until the shift ends", () => {
		const result = assessStaffingSkills({
			requirements: [requirements[1]],
			held: [{ skillId: "first-aid", expiresAt: new Date("2026-10-20T14:00:00Z") }],
			shiftEnd,
		});

		expect(result.warnings).toEqual([]);
	});

	it("only notes an expired preferred skill", () => {
		const result = assessStaffingSkills({
			requirements: [requirements[2]],
			held: [{ skillId: "french", expiresAt: new Date("2026-10-01T00:00:00Z") }],
			shiftEnd,
		});

		expect(result).toEqual({
			warnings: [],
			notes: [{ type: "missingPreferredSkill", skillId: "french", skillName: "French" }],
			reasons: [],
		});
	});

	it("gives no skill reason when nothing is required", () => {
		expect(assessStaffingSkills({ requirements: [], held: [], shiftEnd })).toEqual({
			warnings: [],
			notes: [],
			reasons: [],
		});
	});
});
