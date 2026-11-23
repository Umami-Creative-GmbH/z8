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
