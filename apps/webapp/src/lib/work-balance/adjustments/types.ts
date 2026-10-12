/**
 * Balance adjustments (#804, ADR-0008): opening balances and overtime payouts,
 * kept as an insert-only, cancellable ledger that the work-balance projection
 * adds in. Shared by the server and the client, so this file has no
 * server-only imports.
 */

import type {
	OpeningBalanceCsvColumn,
	OpeningBalanceCsvFileErrorCode,
	OpeningBalanceCsvRowErrorCode,
} from "./opening-balance-csv";

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
	/**
	 * The payout would leave the work balance below zero at the end of the day
	 * of a later uncancelled payout.
	 */
	| "exceeds_later_balance"
	| "already_cancelled"
	/** #997: a payout on or before the day of the opening balance in effect. */
	| "before_opening_balance"
	/**
	 * #997: an opening balance on or after the day of an uncancelled payout. The
	 * refusal lists those payouts (`conflictingPayouts`).
	 */
	| "conflicting_payouts"
	/**
	 * The adjustment's day lies in a closed month of the employee (#762,
	 * ADR-0004); the refusal names the month (`closedMonth`).
	 */
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

/** What a refusal carries beside its code, for the client to show. */
export type BalanceAdjustmentRefusalDetails = {
	/** With `conflicting_payouts`: the payouts dated on or before the opening balance's day. */
	conflictingPayouts?: ConflictingPayout[];
	/** With `month_closed`: the closed month (`YYYY-MM`) the day lies in. */
	closedMonth?: string;
};

/** A refusal the user can act on; thrown by the balance adjustment store and actions. */
export class BalanceAdjustmentRefusal extends Error {
	readonly code: BalanceAdjustmentErrorCode;
	readonly details: BalanceAdjustmentRefusalDetails;

	constructor(
		code: BalanceAdjustmentErrorCode,
		message: string,
		details: BalanceAdjustmentRefusalDetails = {},
	) {
		super(message);
		this.name = "BalanceAdjustmentRefusal";
		this.code = code;
		this.details = details;
	}
}

/** A balance adjustment server action's result; a failure always carries a stable code. */
export type BalanceAdjustmentActionResult<T> =
	| { success: true; data: T }
	| ({
			success: false;
			error: string;
			code: BalanceAdjustmentErrorCode;
	  } & BalanceAdjustmentRefusalDetails);

/** Why one row of a bulk opening balance upload cannot be written (#999). */
export type OpeningBalanceUploadRowErrorCode =
	| OpeningBalanceCsvRowErrorCode
	/** No employee of the organization has the number. */
	| "unknown_employee"
	/** Several employees of the organization share the number. */
	| "ambiguous_employee"
	/** The employee is outside the uploader's payroll access, or is the uploader. */
	| "out_of_scope"
	/** The employee has more than one row in the file. */
	| "duplicate_employee"
	| "future_day"
	| "month_closed"
	| "conflicting_payouts";

export type OpeningBalanceUploadRowError = {
	code: OpeningBalanceUploadRowErrorCode;
	/** With `conflicting_payouts`: the payouts dated on or before the row's day. */
	conflictingPayouts?: ConflictingPayout[];
	/** With `month_closed`: the closed month (`YYYY-MM`) the row's day lies in. */
	closedMonth?: string;
};

/** One row of a bulk opening balance upload, as the preview shows it. */
export type OpeningBalanceUploadRow = {
	/** Spreadsheet row number; the header is row 1. */
	row: number;
	employeeNumber: string;
	/** The matched employee; null when unknown, ambiguous or outside the scope. */
	employee: { id: string; name: string; isActive: boolean } | null;
	/** `YYYY-MM-DD` in the employee's timezone; null when the cell is invalid. */
	day: string | null;
	/** Signed minutes; null when the cell is invalid. */
	minutes: number | null;
	reason: string;
	/** The opening balance in effect, which this row cancels and replaces. */
	replaces: { day: string; minutes: number } | null;
	errors: OpeningBalanceUploadRowError[];
};

/** The outcome of previewing or committing a bulk opening balance upload. */
export type OpeningBalanceUploadOutcome =
	| {
			status: "invalid_file";
			code: OpeningBalanceCsvFileErrorCode;
			missingColumns?: OpeningBalanceCsvColumn[];
	  }
	/** At least one row has an error; nothing was written. */
	| { status: "has_errors"; rows: OpeningBalanceUploadRow[] }
	/** Preview only: every row can be written. */
	| { status: "ready"; rows: OpeningBalanceUploadRow[] }
	/** Every row was written in one transaction. */
	| { status: "committed"; rows: OpeningBalanceUploadRow[]; created: number; replaced: number };
