import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employeeDocument } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { canManageDocument, type PersonnelFileAccess } from "./access";
import { loadEmployeeRef } from "./access-store";
import { writeDocumentAudit } from "./audit";
import { type EmployeeDocumentView, lockDocument, toDocumentViews } from "./document-store";
import { recomputeCertificateSkillExpiry } from "./skill-certificate-expiry";
import {
	type SkillCertificateRuleRefusal,
	skillCertificateRefusal,
} from "./skill-certificate-rules";
import {
	type CertificateSkill,
	listEmployeeCertificateSkills,
	loadCertificateSkill,
} from "./skill-certificate-store";

/**
 * Naming the employee skill a certificate proves, changing it and clearing it
 * (#1144, Scheduling ADR 0001). Only whoever manages the employee's
 * certificates may: an officer covering `certificate` for the employee, an
 * owner or an admin, never on their own file. So an employee cannot name a
 * skill on their own upload, and a manager without an officer grant cannot
 * either. Every change is audited with the actor and the employee skill.
 *
 * The skill expiry date follows the dated skill certificates (#1145,
 * `skill-certificate-expiry.ts`).
 */

type Database = typeof appDb;

export type SkillCertificateLinkRefusal =
	| SkillCertificateRuleRefusal
	/** The employee skill is not one of the document's employee's skills in the organization. */
	| "not_employee_skill";

export type SetCertificateSkillResult =
	| { kind: "saved"; document: EmployeeDocumentView }
	/** The document is not there for the actor, or they do not manage its certificates. */
	| { kind: "not_found" }
	| { kind: "refused"; reason: SkillCertificateLinkRefusal };

/**
 * Makes the certificate name the employee skill, or name none (`null`). The
 * document and the employee skill are checked again under the document's lock.
 */
export async function setCertificateSkill(
	database: Database,
	access: PersonnelFileAccess,
	input: { documentId: string; employeeSkillId: string | null },
	now: Instant = systemClock.nowInstant(),
): Promise<SetCertificateSkillResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const current = await lockDocument(tx, access.organizationId, input.documentId);
		if (!current) return { kind: "not_found" };
		const employee = await loadEmployeeRef(tx, {
			organizationId: access.organizationId,
			employeeId: current.employeeId,
		});
		// Whoever does not manage the certificates of this employee, the
		// employee themselves included, never learns the document exists.
		if (!employee || !canManageDocument(access, employee, "certificate")) {
			return { kind: "not_found" };
		}
		if (!canManageDocument(access, employee, current.category)) return { kind: "not_found" };

		const from = current.employeeSkillId;
		const to = input.employeeSkillId;
		if (to !== null) {
			const proven = await loadCertificateSkill(tx, {
				organizationId: access.organizationId,
				employeeId: current.employeeId,
				employeeSkillId: to,
			});
			const refusal =
				skillCertificateRefusal(current, { requiresExpiry: proven?.requiresExpiry ?? false }) ??
				(proven ? null : "not_employee_skill");
			if (refusal) return { kind: "refused", reason: refusal };
		} else if (current.category !== "certificate") {
			return { kind: "refused", reason: "not_certificate" };
		}

		if (from === to) {
			const [document] = await toDocumentViews(tx, access.organizationId, [current]);
			if (!document) return { kind: "not_found" };
			return { kind: "saved", document };
		}
		const [row] = await tx
			.update(employeeDocument)
			.set({ employeeSkillId: to, updatedBy: access.userId, updatedAt: at })
			.where(
				and(
					eq(employeeDocument.id, current.id),
					eq(employeeDocument.organizationId, access.organizationId),
				),
			)
			.returning();
		if (!row) return { kind: "not_found" };
		await writeDocumentAudit(tx, {
			action:
				to === null
					? AuditAction.PERSONNEL_FILE_SKILL_CERTIFICATE_UNLINKED
					: AuditAction.PERSONNEL_FILE_SKILL_CERTIFICATE_LINKED,
			actorUserId: access.userId,
			document: row,
			changes: { employeeSkillId: { from, to } },
		});
		// The skill expiry date follows the certificates (#1145), for the skill
		// the certificate stopped naming and the one it names now.
		await recomputeCertificateSkillExpiry(tx, {
			organizationId: access.organizationId,
			employeeSkillIds: [from, to],
		});
		const [document] = await toDocumentViews(tx, access.organizationId, [row]);
		if (!document) return { kind: "not_found" };
		return { kind: "saved", document };
	});
}

/**
 * The employee's skills a certificate may name, for whoever manages the
 * employee's certificates. Null when the actor does not (or it is their own file).
 */
export async function listCertificateSkillOptions(
	database: Database,
	access: PersonnelFileAccess,
	employeeId: string,
): Promise<CertificateSkill[] | null> {
	const employee = await loadEmployeeRef(database, {
		organizationId: access.organizationId,
		employeeId,
	});
	if (!employee || !canManageDocument(access, employee, "certificate")) return null;
	return listEmployeeCertificateSkills(database, {
		organizationId: access.organizationId,
		employeeId: employee.id,
	});
}
