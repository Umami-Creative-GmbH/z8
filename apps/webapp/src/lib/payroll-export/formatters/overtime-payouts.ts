import { DateTime } from "luxon";
import { type PayrollExportFileFormatId, payrollExportFormatKind } from "../format-registry";
import type {
	OvertimePayoutData,
	SpecialWageCategory,
	UnmappedOvertimePayout,
	WageTypeMapping,
} from "../types";
import { type WageTypeCodeFormat, wageTypeCodeFor } from "../wage-type-code";

/**
 * Shared rules for the overtime payouts of the DATEV, Lexware and Sage files
 * (#1001) and the SAP SuccessFactors CSV file (#1050): the special category
 * they are paid under, the label of their rows, and the split into payouts a
 * format carries and payouts it reports unmapped.
 */

/** The special category whose wage type an overtime payout is paid under. */
export const OVERTIME_PAYOUT_CATEGORY: SpecialWageCategory = "overtime";

/**
 * The file formats of the format registry (#823) that carry overtime payouts,
 * with the code column each reads. The API connectors do not (#1004).
 */
const OVERTIME_PAYOUT_FORMATS: Readonly<
	Partial<Record<PayrollExportFileFormatId, WageTypeCodeFormat>>
> = {
	datev_lohn: "datev",
	lexware_lohn: "lexware",
	sage_lohn: "sage",
	successfactors_csv: "successFactors",
};

/** The code column a format pays overtime payouts under; null when it carries none. */
export function overtimePayoutCodeFormat(formatId: string): WageTypeCodeFormat | null {
	if (payrollExportFormatKind(formatId) !== "file") {
		return null;
	}
	return OVERTIME_PAYOUT_FORMATS[formatId as PayrollExportFileFormatId] ?? null;
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

export type MappedOvertimePayout = ReturnType<typeof overtimePayoutsForFormat>["mapped"][number];

/**
 * Adds each mapped payout's hours to a formatter's aggregation, keyed by
 * personnel number, then period (the payout's day or month), then wage type
 * code. `add` merges the hours into the entry already there, if any.
 */
export function addOvertimePayoutHours<Entry>(
	aggregated: Map<string, Map<string, Map<string, Entry>>>,
	mapped: readonly MappedOvertimePayout[],
	options: {
		personnelNumber: (payout: OvertimePayoutData) => string;
		period: (payout: OvertimePayoutData) => string;
		add: (existing: Entry | undefined, hours: number) => Entry;
	},
): void {
	for (const { payout, wageTypeCode, hours } of mapped) {
		const personnelNumber = options.personnelNumber(payout);
		const employeeData = aggregated.get(personnelNumber) ?? new Map<string, Map<string, Entry>>();
		aggregated.set(personnelNumber, employeeData);
		const period = options.period(payout);
		const periodData = employeeData.get(period) ?? new Map<string, Entry>();
		employeeData.set(period, periodData);
		periodData.set(wageTypeCode, options.add(periodData.get(wageTypeCode), hours));
	}
}

/** A file's date range widened to the days of the payouts it carries. */
export function widenDateRangeByPayouts(
	range: { start: DateTime | null; end: DateTime | null },
	mapped: readonly MappedOvertimePayout[],
): { start: DateTime | null; end: DateTime | null } {
	let { start, end } = range;
	for (const { payout } of mapped) {
		const payoutDay = DateTime.fromISO(payout.day);
		if (!start || payoutDay < start) start = payoutDay;
		if (!end || payoutDay > end) end = payoutDay;
	}
	return { start, end };
}
