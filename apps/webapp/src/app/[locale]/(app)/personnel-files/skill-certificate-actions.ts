"use server";

import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import type { EmployeeDocumentView } from "@/lib/personnel-file/document-store";
import {
	listCertificateSkillOptions,
	type SkillCertificateLinkRefusal,
	setCertificateSkill,
} from "@/lib/personnel-file/skill-certificate";
import type { CertificateSkill } from "@/lib/personnel-file/skill-certificate-store";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * Officer actions on skill certificates (#1144, Scheduling ADR 0001): name the
 * employee skill a certificate proves, change or clear it, and list the
 * employee's skills to pick from. Only whoever manages the employee's
 * certificates may; for everyone else, the employee themselves included, the
 * document or the employee is not found.
 */

const NOT_FOUND = "Not found";

const REFUSAL_MESSAGES: Readonly<Record<SkillCertificateLinkRefusal, string>> = {
	not_certificate: "Only certificates can prove a skill.",
	undated_requires_expiry:
		"This skill requires an expiry date. Only a certificate with an expiry date can prove it.",
	not_employee_skill: "Choose one of this employee's skills.",
};

export type { CertificateSkill } from "@/lib/personnel-file/skill-certificate-store";

function failure(error: unknown, fallback: string): { success: false; error: string } {
	logger.error({ error }, fallback);
	return { success: false, error: fallback };
}

/** Names the employee skill the certificate proves, or none (`employeeSkillId: null`). */
export async function setCertificateSkillAction(input: {
	documentId: string;
	employeeSkillId: string | null;
}): Promise<ServerActionResult<EmployeeDocumentView>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		const employeeSkillId = input?.employeeSkillId ?? null;
		if (
			current.status !== "resolved" ||
			!isCanonicalUuid(input?.documentId) ||
			(employeeSkillId !== null && !isCanonicalUuid(employeeSkillId))
		) {
			return { success: false, error: NOT_FOUND };
		}
		const result = await setCertificateSkill(db, current.access, {
			documentId: input.documentId,
			employeeSkillId,
		});
		switch (result.kind) {
			case "not_found":
				return { success: false, error: NOT_FOUND };
			case "refused":
				return { success: false, error: REFUSAL_MESSAGES[result.reason], code: result.reason };
			case "saved":
				return { success: true, data: result.document };
		}
	} catch (error) {
		return failure(error, "Failed to save the skill of the certificate");
	}
}

/** The employee's skills a certificate may name. */
export async function listCertificateSkillOptionsAction(
	employeeId: string,
): Promise<ServerActionResult<CertificateSkill[]>> {
	try {
		const current = await loadCurrentPersonnelFileAccess();
		if (current.status !== "resolved" || !isCanonicalUuid(employeeId)) {
			return { success: false, error: NOT_FOUND };
		}
		const skills = await listCertificateSkillOptions(db, current.access, employeeId);
		if (!skills) return { success: false, error: NOT_FOUND };
		return { success: true, data: skills };
	} catch (error) {
		return failure(error, "Failed to load the employee's skills");
	}
}
