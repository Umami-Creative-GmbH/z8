import type {
	OvertimePayoutData,
	SpecialWageCategory,
	UnmappedOvertimePayout,
	WageTypeMapping,
} from "../types";
import { type WageTypeCodeFormat, wageTypeCodeFor } from "../wage-type-code";

/**
 * Shared rules for the overtime payouts of the DATEV, Lexware and Sage files
 * (#1001): the special category they are paid under, the label of their rows,
 * and the split into payouts a format carries and payouts it reports unmapped.
 */

/** The special category whose wage type an overtime payout is paid under. */
export const OVERTIME_PAYOUT_CATEGORY: SpecialWageCategory = "overtime";

/**
 * The file formats that carry overtime payouts. SuccessFactors CSV and the API
 * connectors do not (follow-up issues of #804).
 */
const OVERTIME_PAYOUT_FORMATS: readonly string[] = ["datev_lohn", "lexware_lohn", "sage_lohn"];

export function carriesOvertimePayouts(formatId: string): boolean {
	return OVERTIME_PAYOUT_FORMATS.includes(formatId);
}

/** Bemerkung of an overtime payout row in DATEV and Sage files. */
export const GERMAN_OVERTIME_PAYOUT_NOTE = "Überstundenauszahlung";

/**
 * The payouts with the format's own code from the "overtime" mapping, or all of
 * them as unmapped when the mapping has no code for the format: a format never
 * borrows another format's code.
 */
export function overtimePayoutsForFormat(
	payouts: readonly OvertimePayoutData[],
	mappings: readonly WageTypeMapping[],
	format: WageTypeCodeFormat,
): {
	mapped: Array<{ payout: OvertimePayoutData; wageTypeCode: string; hours: number }>;
	unmapped: UnmappedOvertimePayout[];
} {
	const mapping = mappings.find(
		(candidate) => candidate.specialCategory === OVERTIME_PAYOUT_CATEGORY,
	);
	const wageTypeCode = wageTypeCodeFor(mapping, format);
	if (!wageTypeCode) {
		return {
			mapped: [],
			unmapped: payouts.map(({ id, employeeId, day, minutes }) => ({
				id,
				employeeId,
				day,
				minutes,
			})),
		};
	}
	return {
		mapped: payouts.map((payout) => ({ payout, wageTypeCode, hours: payout.minutes / 60 })),
		unmapped: [],
	};
}
