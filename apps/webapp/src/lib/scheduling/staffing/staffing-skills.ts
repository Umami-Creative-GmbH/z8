import {
	compareInstants,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import type { StaffingNote, StaffingReason, StaffingWarning } from "./types";

export interface StaffingSkillRequirement {
	skillId: string;
	skillName: string;
	/** Required, or only preferred. */
	isRequired: boolean;
}

export interface HeldSkill {
	skillId: string;
	/** Null never expires. */
	expiresAt: Date | null;
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
 * Judges the employee's skills against the shift's requirements as of the shift: a certificate must
 * stay valid until the shift ends, so one valid today but expiring by then counts as expired. A missing or expired preferred
 * skill is only a note.
 */
export function assessStaffingSkills(input: {
	requirements: readonly StaffingSkillRequirement[];
	held: readonly HeldSkill[];
	shiftEnd: Instant;
}): { warnings: StaffingWarning[]; notes: StaffingNote[]; reasons: StaffingReason[] } {
	const heldBySkill = new Map(input.held.map((skill) => [skill.skillId, skill]));
	const warnings: StaffingWarning[] = [];
	const notes: StaffingNote[] = [];
	const skillNamesHeld: string[] = [];

	for (const requirement of input.requirements) {
		const held = heldBySkill.get(requirement.skillId);
		const expiresAt = held?.expiresAt ? instantFromDate(held.expiresAt) : null;
		const isExpired = expiresAt !== null && compareInstants(expiresAt, input.shiftEnd) < 0;

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
				expiresAt: instantToCanonicalString(expiresAt),
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
