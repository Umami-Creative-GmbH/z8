/** The rules of an absence category that decide what its approved absences do. */
export interface AbsenceCategoryRules {
	requiresWorkTime: boolean;
	countsAgainstVacation: boolean;
	drawsOnWorkBalance: boolean;
}

export type AbsenceCategoryRuleConflict =
	| "draws_on_work_balance_with_vacation"
	| "draws_on_work_balance_with_work_time";

/**
 * Time off in lieu is taken against the work balance instead of against vacation, and no
 * work is expected on it: "draws on work balance" combines with neither rule.
 */
export function findAbsenceCategoryRuleConflict(
	rules: AbsenceCategoryRules,
): AbsenceCategoryRuleConflict | null {
	if (!rules.drawsOnWorkBalance) return null;
	if (rules.countsAgainstVacation) return "draws_on_work_balance_with_vacation";
	if (rules.requiresWorkTime) return "draws_on_work_balance_with_work_time";
	return null;
}

/**
 * The category type an External Contractor records unavailability with (#1996): a calendar
 * marker only. It is never vacation, sick leave, time off in lieu or a payroll absence.
 */
export const CONTRACTOR_UNAVAILABILITY_TYPE = "contractor_unavailability";

export function isContractorUnavailabilityType(type: string | null | undefined): boolean {
	return type === CONTRACTOR_UNAVAILABILITY_TYPE;
}

/** Why someone may not record an absence of a category, by their engagement kind (#1996). */
export type EngagementCategoryRefusal =
	| "contractor_records_unavailability_only"
	| "unavailability_is_for_contractors";

/**
 * An External Contractor records only unavailability, never vacation, sick leave or any other
 * employee absence; an employee never records contractor unavailability.
 */
export function engagementCategoryRefusal(
	engagementKind: "employee" | "contractor",
	categoryType: string,
): EngagementCategoryRefusal | null {
	const unavailability = isContractorUnavailabilityType(categoryType);
	if (engagementKind === "contractor") {
		return unavailability ? null : "contractor_records_unavailability_only";
	}
	return unavailability ? "unavailability_is_for_contractors" : null;
}

/** The server's English refusal messages; the request form only offers allowed categories. */
export const ENGAGEMENT_CATEGORY_REFUSAL_MESSAGES: Record<EngagementCategoryRefusal, string> = {
	contractor_records_unavailability_only:
		"An External Contractor can only record unavailability, not vacation or leave",
	unavailability_is_for_contractors: "Only External Contractors record unavailability",
};

/** The rules every contractor unavailability category has; migration 0329 checks them too. */
export const CONTRACTOR_UNAVAILABILITY_RULES = {
	requiresWorkTime: false,
	countsAgainstVacation: false,
	drawsOnWorkBalance: false,
} as const satisfies AbsenceCategoryRules;

/**
 * Whether an approved absence of the category releases its days' required time. A category
 * that requires work time keeps the day a working day; one that draws on the work balance
 * (time off in lieu) keeps the required time, so the work balance falls by it.
 */
export function releasesRequiredTime(
	category: Pick<AbsenceCategoryRules, "requiresWorkTime" | "drawsOnWorkBalance">,
): boolean {
	return !category.requiresWorkTime && !category.drawsOnWorkBalance;
}
