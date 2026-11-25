import type { useTranslate } from "@tolgee/react";
import {
	isStatutoryReviewDomain,
	type StatutoryReviewDomain,
} from "@/lib/statutory/review-domains";

// Shared labels and classes of the unified Settings → Contracts → Reviews & Conflicts inbox (#1994).

type Translate = ReturnType<typeof useTranslate>["t"];

/** The inbox's domain filter: every statutory domain plus the contract migration and departure reviews. */
export type ReviewDomainFilter = "all" | StatutoryReviewDomain | "migration_departure";

export const reviewDomainFilters: readonly ReviewDomainFilter[] = [
	"all",
	"minijob",
	"short_term",
	"working_student",
	"on_call",
	"youth_apprentice",
	"migration_departure",
];

/** The filter a deep link asks for (`?domain=`), or "all". */
export function parseReviewDomainFilter(value: string | null | undefined): ReviewDomainFilter {
	if (!value) return "all";
	return value === "migration_departure" || isStatutoryReviewDomain(value) ? value : "all";
}

export function reviewDomainLabel(filter: ReviewDomainFilter, t: Translate): string {
	switch (filter) {
		case "all":
			return t("settings.contracts.reviews.domain.all", "All");
		case "minijob":
			return t("settings.contracts.reviews.domain.minijob", "Minijob");
		case "short_term":
			return t("settings.contracts.reviews.domain.shortTerm", "Short-Term");
		case "working_student":
			return t("settings.contracts.reviews.domain.workingStudent", "Working Student");
		case "on_call":
			return t("settings.contracts.reviews.domain.onCall", "On-Call");
		case "youth_apprentice":
			return t("settings.contracts.reviews.domain.youthApprentice", "Youth & Apprentice");
		case "migration_departure":
			return t("settings.contracts.reviews.domain.migrationDeparture", "Migration & Departure");
	}
}

/**
 * Classes that highlight an item whose acknowledgement no longer documents it: newer work, shifts
 * or figures invalidated it (`stale`), or the finding can no longer be acknowledged
 * (`no_longer_applies`).
 */
export function invalidatedItemClassName(status: string | null | undefined): string {
	return status === "stale" || status === "no_longer_applies"
		? "border-warning/60 bg-warning/10"
		: "";
}
