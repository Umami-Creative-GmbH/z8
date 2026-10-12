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
 * Whether an approved absence of the category releases its days' required time. A category
 * that requires work time keeps the day a working day; one that draws on the work balance
 * (time off in lieu) keeps the required time, so the work balance falls by it.
 */
export function releasesRequiredTime(
	category: Pick<AbsenceCategoryRules, "requiresWorkTime" | "drawsOnWorkBalance">,
): boolean {
	return !category.requiresWorkTime && !category.drawsOnWorkBalance;
}
