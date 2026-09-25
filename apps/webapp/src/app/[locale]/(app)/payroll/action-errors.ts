import {
	type AnyAppError,
	AuthenticationError,
	AuthorizationError,
	ConflictError,
	DatabaseError,
	ValidationError,
} from "@/lib/effect/errors";
import { PayrollWorkCollectionBlockedError } from "@/lib/payroll-collection/payroll-work-collection-blocked-error";
import { PayrollOffboardingRepairBlockedError } from "@/lib/payroll-export/offboarding-repair-guard";
import { PayrollWorkAllocationBlockedError } from "@/lib/payroll-export/work-allocation-blocked-error";
import { CanonicalCutoverNotReadyError } from "@/lib/time-record/migration/cutover-state";

export type PayrollErrorTranslator = (key: string, fallback: string) => string;

export function mapPayrollWorkspaceActionError(
	error: unknown,
	t: PayrollErrorTranslator,
): AnyAppError {
	if (isKnownPayrollActionError(error)) {
		return error;
	}

	if (error instanceof CanonicalCutoverNotReadyError) {
		return new ConflictError({
			message: t(
				"payroll.errors.dataTemporarilyUnavailable",
				"Payroll data is temporarily unavailable",
			),
			conflictType: "canonical_payroll_data_not_ready",
			details: {
				organizationId: error.organizationId,
				reconciliation: error.reconciliation,
			},
		});
	}

	if (error instanceof PayrollWorkAllocationBlockedError) {
		// Record-level reasons stay in server logs; the workspace lists the scoped blockers.
		return new ConflictError({
			message: t(
				"payroll.errors.exportBlockedByUnresolvedWorkMinutes",
				"Export blocked: resolve the work minutes that need review first",
			),
			conflictType: "payroll_work_minutes_unresolved",
			details: {
				organizationId: error.organizationId,
				blockedRecordCount: error.blockedRecords.length,
			},
		});
	}

	if (error instanceof PayrollWorkCollectionBlockedError) {
		// Counts only; the workspace lists the scoped blockers the reader may see.
		return new ConflictError({
			message: t(
				"payroll.errors.exportBlockedByUncertainWork",
				"Export blocked: resolve the uncertain work in the selected scope first",
			),
			conflictType: "payroll_work_collection_blocked",
			details: {
				organizationId: error.organizationId,
				...error.summary(),
			},
		});
	}

	if (error instanceof PayrollOffboardingRepairBlockedError) {
		return new ConflictError({
			message: t(
				"payroll.errors.exportBlockedByOffboardingClockRepair",
				"Export blocked: repair the offboarding clock-out first",
			),
			conflictType: "payroll_offboarding_clock_repair",
			details: {
				organizationId: error.organizationId,
				blockedEmployeeCount: error.employeeIds.length,
			},
		});
	}

	return new DatabaseError({
		message: t(
			"payroll.errors.actionFailed",
			"Payroll workspace action failed",
		),
		operation: "payroll_workspace_action",
		cause: error,
	});
}

function isKnownPayrollActionError(error: unknown): error is AnyAppError {
	return (
		error instanceof AuthenticationError ||
		error instanceof AuthorizationError ||
		error instanceof ConflictError ||
		error instanceof DatabaseError ||
		error instanceof ValidationError
	);
}
