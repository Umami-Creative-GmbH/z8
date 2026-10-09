/**
 * Why a position capture action was refused (#766). The client translates the
 * code; the English message is a diagnostic for logs only. Shared by the server
 * actions and the client, so this file has no server-only imports.
 */
export type PositionCaptureErrorCode =
	| "sign_in_required"
	| "employee_profile_required"
	| "admin_only"
	| "invalid_work_period"
	| "work_period_not_found"
	| "positions_forbidden"
	| "invalid_notice"
	| "notice_changed"
	| "purpose_required"
	| "purpose_too_long"
	| "retention_out_of_range"
	| "invalid_target"
	| "invalid_selection"
	| "team_not_found"
	| "employee_not_found"
	| "assignment_not_found"
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	| "failed";

/** A refusal the user can act on; thrown by the position capture store and actions. */
export class PositionCaptureRefusal extends Error {
	readonly code: PositionCaptureErrorCode;

	constructor(code: PositionCaptureErrorCode, message: string) {
		super(message);
		this.name = "PositionCaptureRefusal";
		this.code = code;
	}
}

/** A position capture server action's result; a failure always carries a stable code. */
export type PositionCaptureActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: PositionCaptureErrorCode };
