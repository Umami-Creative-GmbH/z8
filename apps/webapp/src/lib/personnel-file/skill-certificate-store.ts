import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employee, employeeDocument, employeeSkill, skill } from "@/db/schema";

/**
 * Reads behind **skill certificates** (#1144, Scheduling ADR 0001): the
 * employee skills a certificate may name, and which employee skills have one
 * on file. `employee_skill` has no organization of its own, so every read is
 * scoped through its employee and its skill.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select" | "selectDistinct">;

/** An employee skill as a certificate names it. */
export interface CertificateSkill {
	employeeSkillId: string;
	/** The skill's name. */
	name: string;
	requiresExpiry: boolean;
}

function employeeSkillsOf(database: Reader, input: { organizationId: string; employeeId: string }) {
	return database
		.select({
			employeeSkillId: employeeSkill.id,
			name: skill.name,
			requiresExpiry: skill.requiresExpiry,
		})
		.from(employeeSkill)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeSkill.employeeId),
				eq(employee.organizationId, input.organizationId),
			),
		)
		.innerJoin(
			skill,
			and(eq(skill.id, employeeSkill.skillId), eq(skill.organizationId, input.organizationId)),
		)
		.where(eq(employeeSkill.employeeId, input.employeeId))
		.$dynamic();
}

/** One employee skill of the employee in the organization, or null. */
export async function loadCertificateSkill(
	database: Reader,
	input: { organizationId: string; employeeId: string; employeeSkillId: string },
): Promise<CertificateSkill | null> {
	const [row] = await employeeSkillsOf(database, input)
		.where(
			and(
				eq(employeeSkill.employeeId, input.employeeId),
				eq(employeeSkill.id, input.employeeSkillId),
			),
		)
		.limit(1);
	return row ?? null;
}

/** Every employee skill of the employee in the organization, by skill name. */
export async function listEmployeeCertificateSkills(
	database: Reader,
	input: { organizationId: string; employeeId: string },
): Promise<CertificateSkill[]> {
	return employeeSkillsOf(database, input).orderBy(asc(skill.name), asc(employeeSkill.id));
}

/**
 * The employee skills among the given ones that a certificate of the
 * organization names. Callers learn only that one is on file, never which
 * document or what it says; opening it goes through personnel file access.
 */
export async function loadSkillCertificatesOnFile(
	database: Reader,
	input: { organizationId: string; employeeSkillIds: readonly string[] },
): Promise<Set<string>> {
	const ids = [...new Set(input.employeeSkillIds)];
	if (ids.length === 0) return new Set();
	const rows = await database
		.selectDistinct({ employeeSkillId: employeeDocument.employeeSkillId })
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, input.organizationId),
				eq(employeeDocument.category, "certificate"),
				isNotNull(employeeDocument.employeeSkillId),
				inArray(employeeDocument.employeeSkillId, ids),
			),
		);
	return new Set(rows.flatMap((row) => (row.employeeSkillId ? [row.employeeSkillId] : [])));
}
