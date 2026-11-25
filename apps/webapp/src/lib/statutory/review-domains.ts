/**
 * The statutory domains of the unified Reviews inbox (#1994). Client-safe: no server imports.
 * JArbSchG youth protection and BBiG apprentice release share one domain.
 */
import type { StatutoryDomain } from "./threshold-catalog";

export const statutoryReviewDomains = [
	"minijob",
	"short_term",
	"working_student",
	"on_call",
	"youth_apprentice",
] as const;
export type StatutoryReviewDomain = (typeof statutoryReviewDomains)[number];

export function isStatutoryReviewDomain(value: string): value is StatutoryReviewDomain {
	return (statutoryReviewDomains as readonly string[]).includes(value);
}

export function statutoryReviewDomainOf(domain: StatutoryDomain): StatutoryReviewDomain {
	switch (domain) {
		case "minijob":
		case "short_term":
		case "working_student":
		case "on_call":
			return domain;
		case "youth_protection":
		case "apprenticeship":
			return "youth_apprentice";
	}
}
