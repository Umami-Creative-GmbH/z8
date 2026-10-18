import type { PayrollBaselineSummary } from "./baseline-types";
import type { SupportedPayrollOutputRow } from "./supported-output-evidence";
import type { SerializedPayrollExportFilters } from "./types";

export type PayrollRowChangeStatus = "added" | "removed" | "changed";
export interface PayrollRowChange {
	/** Exact destination grouping, independent of source record kind. */
	key: string;
	status: PayrollRowChangeStatus;
	employeeIds: string[];
	oldRow: SupportedPayrollOutputRow | null;
	newRow: SupportedPayrollOutputRow | null;
	/** Signed fixed-two-decimal difference of the emitted quantities. */
	delta: string;
	changedFields: string[];
}
export interface PayrollCodeTotal {
	wageTypeCode: string;
	unit: string;
	oldQuantity: string;
	newQuantity: string;
	delta: string;
	/** Includes note/identifier/date changes even with zero net quantity. */
	hasPayrollImpact: boolean;
}
export interface PayrollEmployeeChange {
	employeeId: string;
	firstName: string | null;
	lastName: string | null;
	status: PayrollRowChangeStatus | "source_only" | "unchanged";
	oldPersonnelNumbers: string[];
	newPersonnelNumbers: string[];
	rowKeys: string[];
	totals: PayrollCodeTotal[];
}
export interface PayrollSourceOnlyChange {
	key: string;
	employeeIds: string[];
	oldRow: SupportedPayrollOutputRow;
	newRow: SupportedPayrollOutputRow;
	outputImpact: "none";
}
export interface PayrollOutputComparison {
	version: 1;
	formatId: "datev_lohn" | "lexware_lohn" | "sage_lohn";
	formatterVersions: { old: string; new: string };
	excludedLineKinds: string[];
	hasPayrollImpact: boolean;
	rows: PayrollRowChange[];
	employees: PayrollEmployeeChange[];
	totals: PayrollCodeTotal[];
	sourceOnlyChanges: PayrollSourceOnlyChange[];
	summary: {
		addedRows: number;
		removedRows: number;
		changedRows: number;
		addedEmployees: number;
		removedEmployees: number;
		changedEmployees: number;
		sourceOnlyEmployees: number;
	};
}
export interface ReviewedPayrollComparison {
	id: string;
	baseline: PayrollBaselineSummary;
	preparedAt: string;
	expiresAt: string;
	filters: SerializedPayrollExportFilters;
	comparison: PayrollOutputComparison;
	explanations?: PayrollComparisonExplanation[];
}

export interface PayrollComparisonExplanation {
	kind: "work" | "absence" | "overtime_payout";
	sourceId: string;
	employeeId: string;
	action: string;
	actorId: string | null;
	reason: string | null;
}
export type PayrollComparisonPreparation =
	| { status: "ready"; result: ReviewedPayrollComparison }
	| {
			status: "blocked";
			blockers: readonly {
				employeeId: string;
				reason: string;
				message?: string;
			}[];
	  }
	| { status: "incompatible"; reason: string }
	| { status: "unavailable" };
