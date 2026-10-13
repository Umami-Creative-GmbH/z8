import type { PlainDate } from "@/lib/datetime/temporal-core";
import { isExpiredSkillOn } from "@/lib/scheduling/skill-expiry";
import type { StaffingNote, StaffingReason, StaffingWarning } from "./types";

export interface StaffingSkillRequirement {
	skillId: string;
	skillName: string;
	/** Required, or only preferred. */
	isRequired: boolean;
}

export interface HeldSkill {
	skillId: string;
	/** Skill expiry date (`YYYY-MM-DD`, last valid day); null never expires. */
	expiresAt: string | null;
}

/**
 * The subarea's and the shift template's requirements as one list, one entry per skill, with
 * "required" winning over "preferred", as `SkillService.validateEmployeeForShift` resolves them.
 */
export function resolveSkillRequirements(
	requirements: readonly StaffingSkillRequirement[],
): StaffingSkillRequirement[] {
	const bySkill = new Map<string, StaffingSkillRequirement>();
	for (const requirement of requirements) {
		const existing = bySkill.get(requirement.skillId);
		if (!existing || (requirement.isRequired && !existing.isRequired)) {
			bySkill.set(requirement.skillId, requirement);
		}
	}
	return [...bySkill.values()];
}

/**
 * Judges the employee's skills against the shift's requirements on the shift date: an expired skill
 * (`isExpiredSkillOn`) for that date counts as missing, even when it is valid today. A missing or
 * expired preferred skill is only a note.
 */
export function assessStaffingSkills(input: {
	requirements: readonly StaffingSkillRequirement[];
	held: readonly HeldSkill[];
	shiftDate: PlainDate;
}): { warnings: StaffingWarning[]; notes: StaffingNote[]; reasons: StaffingReason[] } {
	const heldBySkill = new Map(input.held.map((skill) => [skill.skillId, skill]));
	const warnings: StaffingWarning[] = [];
	const notes: StaffingNote[] = [];
	const skillNamesHeld: string[] = [];

	for (const requirement of input.requirements) {
		const held = heldBySkill.get(requirement.skillId);
		const expiresAt = held?.expiresAt ?? null;
		const isExpired = isExpiredSkillOn(expiresAt, input.shiftDate);

		if (held && !isExpired) {
			skillNamesHeld.push(requirement.skillName);
		} else if (!requirement.isRequired) {
			notes.push({
				type: "missingPreferredSkill",
				skillId: requirement.skillId,
				skillName: requirement.skillName,
			});
		} else if (expiresAt) {
			warnings.push({
				type: "expiredRequiredSkill",
				skillId: requirement.skillId,
				skillName: requirement.skillName,
				expiresAt,
			});
		} else {
			warnings.push({
				type: "missingRequiredSkill",
				skillId: requirement.skillId,
				skillName: requirement.skillName,
			});
		}
	}

	return {
		warnings,
		notes,
		reasons: skillNamesHeld.length > 0 ? [{ type: "skillsHeld", skillNames: skillNamesHeld }] : [],
	};
}
