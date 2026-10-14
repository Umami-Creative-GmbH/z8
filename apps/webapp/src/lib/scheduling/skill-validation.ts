import { eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	employeeSkill,
	shiftTemplateSkillRequirement,
	type skill,
	subareaSkillRequirement,
} from "@/db/schema";
import { loadSkillCertificatesOnFile } from "@/lib/personnel-file/skill-certificate-store";
import { isExpiredSkillOn } from "./skill-expiry";

/**
 * The one check of an employee's skills against a shift's requirements on the
 * shift date (#1142): the qualification checks and the shift save warning all
 * read it. Requirements come from the subarea and, when given, the shift
 * template; an expired skill counts as not held, and a skill certificate on
 * file is flagged (#1144) without revealing the document. Every row is scoped
 * to the organization: `employee_skill` and the requirements have no
 * organization of their own, so they are scoped through their skill.
 */

type Database = typeof appDb;
type Skill = typeof skill.$inferSelect;
type SkillCategory = Skill["category"];

export interface SkillValidationResult {
	isQualified: boolean;
	missingSkills: Array<{
		id: string;
		name: string;
		category: SkillCategory;
		isRequired: boolean;
	}>;
	/** Required skills that are expired skills on the shift date. */
	expiredSkills: Array<{
		id: string;
		name: string;
		/** Skill expiry date, `YYYY-MM-DD`. */
		expiresAt: string;
		/** A skill certificate is on file for this employee skill (#1144); never its content. */
		certificateOnFile: boolean;
	}>;
}

/** Drops rows whose skill belongs to another organization (pre-#1135 data). */
export function withOrganizationSkills<Row extends { skill: { organizationId: string } }>(
	organizationId: string,
	rows: Row[],
): Row[] {
	return rows.filter((row) => row.skill.organizationId === organizationId);
}

/**
 * Checks the employee against the subarea's (and template's) skill
 * requirements on `shiftDate` (`YYYY-MM-DD` on the organization's calendar).
 * Callers verify that the employee, subarea and template belong to the
 * organization.
 */
export async function loadSkillValidation(
	database: Database,
	input: {
		organizationId: string;
		employeeId: string;
		subareaId: string;
		templateId?: string | null;
		shiftDate: string;
	},
): Promise<SkillValidationResult> {
	const { organizationId, templateId } = input;
	const [employeeSkills, subareaRequirements, templateRequirements] = await Promise.all([
		database.query.employeeSkill.findMany({
			where: eq(employeeSkill.employeeId, input.employeeId),
			with: { skill: true },
		}),
		database.query.subareaSkillRequirement.findMany({
			where: eq(subareaSkillRequirement.subareaId, input.subareaId),
			with: { skill: true },
		}),
		templateId
			? database.query.shiftTemplateSkillRequirement.findMany({
					where: eq(shiftTemplateSkillRequirement.templateId, templateId),
					with: { skill: true },
				})
			: Promise.resolve([]),
	]);

	// Requirements deduped by skill; required wins over optional.
	const requirements = new Map<string, { skill: Skill; isRequired: boolean }>();
	for (const requirement of withOrganizationSkills(organizationId, [
		...subareaRequirements,
		...templateRequirements,
	])) {
		const existing = requirements.get(requirement.skillId);
		if (!existing || (requirement.isRequired && !existing.isRequired)) {
			requirements.set(requirement.skillId, {
				skill: requirement.skill,
				isRequired: requirement.isRequired,
			});
		}
	}

	const held = withOrganizationSkills(organizationId, employeeSkills);
	const validSkillIds = new Set(
		held
			.filter((row) => !isExpiredSkillOn(row.expiresAt, input.shiftDate))
			.map((row) => row.skillId),
	);
	const expired = held.flatMap((row) =>
		row.expiresAt !== null &&
		requirements.has(row.skillId) &&
		isExpiredSkillOn(row.expiresAt, input.shiftDate)
			? [{ ...row, expiresAt: row.expiresAt }]
			: [],
	);

	const missingSkills: SkillValidationResult["missingSkills"] = [];
	for (const [skillId, { skill: required, isRequired }] of requirements) {
		if (!validSkillIds.has(skillId)) {
			missingSkills.push({
				id: skillId,
				name: required.name,
				category: required.category,
				isRequired,
			});
		}
	}

	const onFile = await loadSkillCertificatesOnFile(database, {
		organizationId,
		employeeSkillIds: expired.map((row) => row.id),
	});
	const expiredSkills = expired.map((row) => ({
		id: row.skillId,
		name: row.skill.name,
		expiresAt: row.expiresAt,
		certificateOnFile: onFile.has(row.id),
	}));

	return {
		isQualified: !missingSkills.some((entry) => entry.isRequired) && expiredSkills.length === 0,
		missingSkills,
		expiredSkills,
	};
}
