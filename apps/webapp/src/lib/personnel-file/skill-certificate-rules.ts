import type { DocumentCategory } from "./document.types";

/**
 * Which employee documents may name an employee skill as its **skill
 * certificate** (#1144, Scheduling ADR 0001). Only a certificate may, and a
 * skill that requires an expiry date only from a certificate that has one: an
 * undated certificate may name a skill that never expires.
 */

export type SkillCertificateRuleRefusal =
	/** Only certificates can prove an employee skill. */
	| "not_certificate"
	/** The skill requires an expiry date, and the certificate has none. */
	| "undated_requires_expiry";

export function skillCertificateRefusal(
	document: { category: DocumentCategory; expiryDate: string | null },
	skill: { requiresExpiry: boolean },
): SkillCertificateRuleRefusal | null {
	if (document.category !== "certificate") return "not_certificate";
	if (skill.requiresExpiry && document.expiryDate === null) return "undated_requires_expiry";
	return null;
}
