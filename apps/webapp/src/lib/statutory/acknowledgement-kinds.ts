/**
 * Statutory acknowledgement kinds, stored as `contract_review_acknowledgement.review_kind`.
 * Each Milestone 2 monitor owns its kinds; add a kind here (one line, plus its domain) when a
 * monitor needs a new documented decision.
 */
import type { StatutoryDomain } from "./threshold-catalog";

export const statutoryAcknowledgementKindDomains = {
	/** #1989: one of up to two unforeseeable Minijob exceedance months (≤ 2× cap) in 12 months. */
	minijob_unforeseeable_exceedance: "minijob",
	/** #1990: employer verified Berufsmäßigkeit after short-term earnings exceeded the Minijob cap. */
	short_term_berufsmaessigkeit_verified: "short_term",
	/** #1991: a reviewed working-student week above 20 h. */
	working_student_over_20h_week: "working_student",
	/** #1992: employee voluntarily agreed to a call-in with less than 4 full days' notice. */
	on_call_short_notice_agreement: "on_call",
	/** #1993: a configured JArbSchG statutory sector exception (night, weekend, holiday work). */
	jarbschg_sector_exception: "youth_protection",
} as const satisfies Record<string, StatutoryDomain>;

export type StatutoryAcknowledgementKind = keyof typeof statutoryAcknowledgementKindDomains;

export const statutoryAcknowledgementKinds = Object.keys(
	statutoryAcknowledgementKindDomains,
) as StatutoryAcknowledgementKind[];

export function isStatutoryAcknowledgementKind(
	value: string,
): value is StatutoryAcknowledgementKind {
	return Object.hasOwn(statutoryAcknowledgementKindDomains, value);
}
