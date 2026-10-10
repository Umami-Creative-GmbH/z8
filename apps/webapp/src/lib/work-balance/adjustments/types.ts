/**
 * Balance adjustments (#804, ADR-0008): opening balances and overtime payouts,
 * kept as an insert-only, cancellable ledger that the work-balance projection
 * adds in. Shared by the server and the client, so this file has no
 * server-only imports.
 */

export const BALANCE_ADJUSTMENT_KINDS = ["opening_balance", "overtime_payout"] as const;

export type BalanceAdjustmentKind = (typeof BALANCE_ADJUSTMENT_KINDS)[number];

/** One adjustment as the Work balance section shows it. */
export type BalanceAdjustmentView = {
	id: string;
	kind: BalanceAdjustmentKind;
	/** Local date in the employee's effective timezone (`YYYY-MM-DD`). */
	day: string;
	/** Signed minutes: an overtime payout is negative. */
	minutes: number;
	reason: string;
	recordedAt: string;
	recordedBy: { userId: string; name: string };
	cancellation: {
		cancelledAt: string;
		cancelledBy: { userId: string; name: string };
		reason: string;
	} | null;
};

/**
 * Why a balance adjustment action was refused. The client translates the
 * code; the English message is a diagnostic for logs only.
 */
export type BalanceAdjustmentErrorCode =
	| "not_permitted"
	| "invalid_input"
	| "employee_not_found"
	| "adjustment_not_found"
	| "reason_required"
	| "amount_not_positive"
	| "future_day"
	| "exceeds_balance"
	| "already_cancelled"
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	| "failed";

/** A refusal the user can act on; thrown by the balance adjustment store and actions. */
export class BalanceAdjustmentRefusal extends Error {
	readonly code: BalanceAdjustmentErrorCode;

	constructor(code: BalanceAdjustmentErrorCode, message: string) {
		super(message);
		this.name = "BalanceAdjustmentRefusal";
		this.code = code;
	}
}

/** A balance adjustment server action's result; a failure always carries a stable code. */
export type BalanceAdjustmentActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: BalanceAdjustmentErrorCode };
