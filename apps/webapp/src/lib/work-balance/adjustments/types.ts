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
	/** #997: a payout on or before the day of the opening balance in effect. */
	| "before_opening_balance"
	/**
	 * #997: an opening balance on or after the day of an uncancelled payout. The
	 * refusal lists those payouts (`conflictingPayouts`).
	 */
	| "conflicting_payouts"
	/** A day in a closed month (#762, ADR-0004); not raised until closed months exist. */
	| "month_closed"
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	| "failed";

/** An uncancelled overtime payout that keeps an opening balance from being set (#997). */
export type ConflictingPayout = {
	id: string;
	/** Local date in the employee's effective timezone (`YYYY-MM-DD`). */
	day: string;
	/** Signed minutes, negative like every payout. */
	minutes: number;
};

/** A refusal the user can act on; thrown by the balance adjustment store and actions. */
export class BalanceAdjustmentRefusal extends Error {
	readonly code: BalanceAdjustmentErrorCode;
	/** Set with `conflicting_payouts`: the payouts dated on or before the opening balance's day. */
	readonly conflictingPayouts?: ConflictingPayout[];

	constructor(
		code: BalanceAdjustmentErrorCode,
		message: string,
		details?: { conflictingPayouts?: ConflictingPayout[] },
	) {
		super(message);
		this.name = "BalanceAdjustmentRefusal";
		this.code = code;
		if (details?.conflictingPayouts) this.conflictingPayouts = details.conflictingPayouts;
	}
}

/** A balance adjustment server action's result; a failure always carries a stable code. */
export type BalanceAdjustmentActionResult<T> =
	| { success: true; data: T }
	| {
			success: false;
			error: string;
			code: BalanceAdjustmentErrorCode;
			/** With `conflicting_payouts` (#997). */
			conflictingPayouts?: ConflictingPayout[];
	  };
