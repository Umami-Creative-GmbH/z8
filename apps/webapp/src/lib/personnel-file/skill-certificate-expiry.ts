import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employee, employeeDocument, employeeSkill, skill } from "@/db/schema";
import { isPersonnelFilesEnabled } from "./access-store";
import { certificateSkillExpiryDate } from "./skill-certificate-rules";

/**
 * Skill certificates set the skill expiry date (#1145, Scheduling ADR 0001).
 * While the organization has personnel files enabled and at least one dated
 * skill certificate names an employee skill, its skill expiry date is the
 * latest expiry date among those certificates, and the skill side cannot edit
 * it. When the last dated one goes, the employee skill keeps the date it had.
 *
 * Lock order: a personnel file write locks its documents first and the
 * employee skills last (`recomputeCertificateSkillExpiry`); a skill-side edit
 * locks the employee skill and then only reads documents. So a link that
 * commits while the skill side edits either waits for that edit and then
 * overwrites it, or makes the edit see the certificate and refuse.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/**
 * The employee skills among the given ones whose skill expiry date skill
 * certificates set, with that date (`YYYY-MM-DD`). Empty while the
 * organization has personnel files disabled: then nothing controls the date.
 */
export async function loadCertificateSkillExpiryDates(
	database: Reader,
	input: { organizationId: string; employeeSkillIds: readonly string[] },
): Promise<Map<string, string>> {
	const ids = [...new Set(input.employeeSkillIds)];
	if (ids.length === 0) return new Map();
	if (!(await isPersonnelFilesEnabled(database, input.organizationId))) return new Map();
	const rows = await database
		.select({
			employeeSkillId: employeeDocument.employeeSkillId,
			expiryDate: employeeDocument.expiryDate,
		})
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, input.organizationId),
				eq(employeeDocument.category, "certificate"),
				isNotNull(employeeDocument.expiryDate),
				inArray(employeeDocument.employeeSkillId, ids),
			),
		);
	const datesBySkill = new Map<string, string[]>();
	for (const row of rows) {
		if (!row.employeeSkillId || !row.expiryDate) continue;
		const dates = datesBySkill.get(row.employeeSkillId) ?? [];
		dates.push(row.expiryDate);
		datesBySkill.set(row.employeeSkillId, dates);
	}
	const result = new Map<string, string>();
	for (const [employeeSkillId, dates] of datesBySkill) {
		const date = certificateSkillExpiryDate(dates);
		if (date) result.set(employeeSkillId, date);
	}
	return result;
}

/**
 * Moves the skill expiry date of each given employee skill to the one its
 * dated skill certificates set, in the caller's transaction. Call it after a
 * certificate was linked, re-dated, unlinked, deleted or purged, with the
 * employee skills it named before and after. An employee skill no dated
 * certificate names any more keeps its date. Only employee skills of the
 * organization (through their employee and their skill) are touched.
 */
export async function recomputeCertificateSkillExpiry(
	tx: Transaction,
	input: {
		organizationId: string;
		employeeSkillIds: readonly (string | null)[];
		/**
		 * Employee skills among them that lose their date instead of keeping it
		 * when no dated certificate names them (an accepted renewal, #1307).
		 */
		clearWhenUndated?: readonly string[];
	},
): Promise<void> {
	const ids = [...new Set(input.employeeSkillIds.flatMap((id) => (id ? [id] : [])))];
	if (ids.length === 0) return;
	const locked = await tx
		.select({ id: employeeSkill.id, expiresAt: employeeSkill.expiresAt })
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
		.where(inArray(employeeSkill.id, ids))
		.orderBy(asc(employeeSkill.id))
		.for("update", { of: employeeSkill });
	if (locked.length === 0) return;
	const dates = await loadCertificateSkillExpiryDates(tx, {
		organizationId: input.organizationId,
		employeeSkillIds: locked.map((row) => row.id),
	});
	const clearWhenUndated = new Set(input.clearWhenUndated ?? []);
	for (const row of locked) {
		const date = dates.get(row.id) ?? (clearWhenUndated.has(row.id) ? null : undefined);
		if (date === undefined || date === row.expiresAt) continue;
		await tx.update(employeeSkill).set({ expiresAt: date }).where(eq(employeeSkill.id, row.id));
	}
}
