import type { ProtectedMinuteBlockReason } from "@/lib/payroll-allocation/protected-minutes";

export interface BlockedPayrollWorkRecord {
	recordId: string;
	employeeId: string;
	reason: ProtectedMinuteBlockReason;
}

/**
 * A requested payroll export is all-or-blocked: when any in-scope work record cannot be credited
 * under the protected-minute rule, the export fails instead of omitting that work.
 */
export class PayrollWorkAllocationBlockedError extends Error {
	constructor(
		readonly organizationId: string,
		readonly blockedRecords: readonly BlockedPayrollWorkRecord[],
	) {
		super(
			`Payroll export blocked: ${blockedRecords.length} work record(s) have unresolved payroll minutes`,
		);
		this.name = "PayrollWorkAllocationBlockedError";
	}
}
