import type { PayrollWorkBlocker, PayrollWorkBlockerKind } from "./payroll-work-collection";

/**
 * A requested payroll export is all-or-blocked (#322): when the scoped collection
 * finds any uncertain work, the export is refused instead of omitting it. The
 * blockers name only employees inside the requested scope; record-level detail stays
 * in server logs and the tenant-authorized workspace and diagnostics.
 */
export class PayrollWorkCollectionBlockedError extends Error {
	constructor(
		readonly organizationId: string,
		readonly blockers: readonly PayrollWorkBlocker[],
	) {
		super(
			`Payroll export blocked: ${blockers.length} uncertain work item(s) in the requested scope`,
		);
		this.name = "PayrollWorkCollectionBlockedError";
	}

	/** Counts per blocker kind and affected employees, without identities. */
	summary(): {
		blockerCounts: Partial<Record<PayrollWorkBlockerKind, number>>;
		affectedEmployeeCount: number;
	} {
		const blockerCounts: Partial<Record<PayrollWorkBlockerKind, number>> = {};
		for (const blocker of this.blockers) {
			blockerCounts[blocker.kind] = (blockerCounts[blocker.kind] ?? 0) + 1;
		}
		return {
			blockerCounts,
			affectedEmployeeCount: new Set(this.blockers.map((blocker) => blocker.employeeId)).size,
		};
	}
}
