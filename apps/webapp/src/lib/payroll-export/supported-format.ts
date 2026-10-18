import type { PayrollBaselineDestination } from "./baseline-types";
export type SupportedPayrollFormatId =
	| "datev_lohn"
	| "lexware_lohn"
	| "sage_lohn";
export function isSupportedPayrollFormat(
	value: string,
): value is SupportedPayrollFormatId {
	return (
		value === "datev_lohn" || value === "lexware_lohn" || value === "sage_lohn"
	);
}
/** DATEV exposes destination numbers; other file targets are identified by their configured target. */
export function payrollDestination(
	formatId: SupportedPayrollFormatId,
	configId: string,
	config: Record<string, unknown>,
): PayrollBaselineDestination {
	return {
		configId,
		mandantennummer:
			formatId === "datev_lohn" ? String(config.mandantennummer ?? "") : "",
		beraternummer:
			formatId === "datev_lohn" ? String(config.beraternummer ?? "") : "",
	};
}
export function samePayrollDestination(
	formatId: SupportedPayrollFormatId,
	current: PayrollBaselineDestination,
	historical: PayrollBaselineDestination,
): boolean {
	return formatId === "datev_lohn"
		? current.mandantennummer === historical.mandantennummer &&
				current.beraternummer === historical.beraternummer
		: current.configId === historical.configId;
}

export function payrollFormatLabel(formatId: SupportedPayrollFormatId): string {
	switch (formatId) {
		case "datev_lohn":
			return "DATEV Lohn & Gehalt";
		case "lexware_lohn":
			return "Lexware lohn+gehalt";
		case "sage_lohn":
			return "Sage Lohn";
	}
}
export function payrollDestinationLabel(
	formatId: SupportedPayrollFormatId,
	destination: PayrollBaselineDestination,
): string {
	return formatId === "datev_lohn"
		? `${destination.mandantennummer} / ${destination.beraternummer}`
		: destination.configId;
}
