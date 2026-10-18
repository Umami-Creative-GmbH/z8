import type { SupportedPayrollOutputEvidence } from "./supported-output-evidence";
import type { SerializedPayrollExportFilters } from "./types";
export interface PayrollBaselineDestination {
	configId: string;
	mandantennummer: string;
	beraternummer: string;
}
export interface PayrollBaselineEvidence {
	version: 1;
	destination: PayrollBaselineDestination;
	config: Record<string, unknown>;
	filters: SerializedPayrollExportFilters;
	period: { startDate: string; endDate: string };
	employeeIds: string[];
	employeeWindowsUnavailable?: true;
	employeeWindows: {
		employeeId: string;
		timezone: string;
		startUtc: string;
		endExclusiveUtc: string;
	}[];
	output: SupportedPayrollOutputEvidence;
	/** Binds the successful file bytes to this exact output attempt. */
	fileDigest: string;
	attemptId: string;
}
export type PayrollBaselineAvailability =
	| "available"
	| "empty"
	| "legacy"
	| "expired"
	| "erased"
	| "corrupt"
	| "unsupported_version";
export interface PayrollBaselineSummary {
	id: string;
	jobId: string;
	formatId: "datev_lohn";
	destination: PayrollBaselineDestination;
	period: { startDate: string; endDate: string };
	employeeIds: string[];
	createdAt: string;
	completedAt: string;
	expiresAt: string;
	availability: PayrollBaselineAvailability;
}
export interface PayrollBaselineDetail {
	summary: PayrollBaselineSummary;
	evidence: PayrollBaselineEvidence | null;
}
