/**
 * The contractor compensation bases and day-unit rules (#1998). Dependency-free:
 * the schema (`db/schema/contractor-compensation.ts`) imports it.
 */

export const compensationBases = ["hourly", "daily"] as const;
export type CompensationBasis = (typeof compensationBases)[number];

export const dayUnitRuleKinds = [
	"any_work_full_day",
	"half_and_full_day",
	"prorated_by_standard_day",
] as const;
export type DayUnitRuleKind = (typeof dayUnitRuleKinds)[number];

/** Terms as the database stores them (`contractor_compensation_terms` columns), wire-safe. */
export interface StoredContractorCompensation {
	compensationBasis: CompensationBasis;
	rateAmount: string;
	currency: string;
	dayUnitRule: DayUnitRuleKind | null;
	halfDayThresholdMinutes: number | null;
	standardDayMinutes: number | null;
	capAtOneDay: boolean | null;
}
