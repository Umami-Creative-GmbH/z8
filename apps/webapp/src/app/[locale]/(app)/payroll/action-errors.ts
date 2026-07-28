import {
	type AnyAppError,
	AuthenticationError,
	AuthorizationError,
	ConflictError,
	DatabaseError,
	ValidationError,
} from "@/lib/effect/errors";
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
