import { Temporal } from "temporal-polyfill";
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

/**
 * The skill expiry date the skill certificates of one employee skill set
 * (#1145): the latest expiry date among the dated ones (`YYYY-MM-DD`). Null
 * when none is dated, and then the employee skill keeps the date it has.
 */
export function certificateSkillExpiryDate(expiryDates: readonly (string | null)[]): string | null {
	let latest: Temporal.PlainDate | null = null;
	for (const value of expiryDates) {
		if (value === null) continue;
		const day = Temporal.PlainDate.from(value);
		if (latest === null || Temporal.PlainDate.compare(day, latest) > 0) latest = day;
	}
	return latest?.toString() ?? null;
}
