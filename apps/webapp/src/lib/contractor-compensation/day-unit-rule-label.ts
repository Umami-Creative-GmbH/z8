import {
	type ContractorCompensationView,
	DEFAULT_CAP_AT_ONE_DAY,
	DEFAULT_HALF_DAY_THRESHOLD_MINUTES,
	DEFAULT_STANDARD_DAY_MINUTES,
	type DayUnitRule,
} from "./terms";

/**
 * The one wording of a daily rate's day-unit rule (#1998, #2000): the
 * compensation editor, the Settings → Contracts overview and the Contractor
 * Time & Fee Statement all say it the same way. Keys live in `common`, which
 * every app route and the server load. Client-safe.
 */

/** Tolgee's `t` (client `useTranslate` or server `getTranslate`). */
export type DayUnitRuleTranslate = (
	key: string,
	defaultValue: string,
	params?: Record<string, string | number>,
) => string;

/** "Half day up to 240 min, full day above". */
export function dayUnitRuleLabel(t: DayUnitRuleTranslate, rule: DayUnitRule): string {
	switch (rule.kind) {
		case "any_work_full_day":
			return t(
				"common:contractorCompensation.dayUnitRules.anyWorkFullDay",
				"Any day with work counts as a full day",
			);
		case "half_and_full_day":
			return t(
				"common:contractorCompensation.dayUnitRules.halfAndFullDay",
				"Half day up to {minutes} min, full day above",
				{ minutes: rule.halfDayThresholdMinutes },
			);
		case "prorated_by_standard_day":
			return rule.capAtOneDay
				? t(
						"common:contractorCompensation.dayUnitRules.proratedCapped",
						"Prorated by a {minutes}-minute day, at most one day",
						{ minutes: rule.standardDayMinutes },
					)
				: t(
						"common:contractorCompensation.dayUnitRules.proratedUncapped",
						"Prorated by a {minutes}-minute day, without a cap",
						{ minutes: rule.standardDayMinutes },
					);
	}
}

/** The day-unit rule of wire-safe terms; null for an hourly rate. */
export function dayUnitRuleOfView(terms: ContractorCompensationView): DayUnitRule | null {
	if (terms.compensationBasis !== "daily") return null;
	switch (terms.dayUnitRule) {
		case "half_and_full_day":
			return {
				kind: "half_and_full_day",
				halfDayThresholdMinutes:
					terms.halfDayThresholdMinutes ?? DEFAULT_HALF_DAY_THRESHOLD_MINUTES,
			};
		case "prorated_by_standard_day":
			return {
				kind: "prorated_by_standard_day",
				standardDayMinutes: terms.standardDayMinutes ?? DEFAULT_STANDARD_DAY_MINUTES,
				capAtOneDay: terms.capAtOneDay ?? DEFAULT_CAP_AT_ONE_DAY,
			};
		default:
			return { kind: "any_work_full_day" };
	}
}
