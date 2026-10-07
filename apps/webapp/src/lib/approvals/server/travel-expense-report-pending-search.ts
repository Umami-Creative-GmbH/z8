/**
 * Finding and locking the pending legacy request of a submitted travel expense
 * report cycle (#603 withdrawal). Decisions lock the request before the report,
 * so the withdrawal does too; a decision committed meanwhile is only seen once
 * the locking read is repeated. Kept free of database imports so the outcome
 * rules are unit tested.
 */

export type PendingReportRequestSearch<Row> =
	/** Locked (possibly more than one row: the caller treats that as inconsistent). */
	| { kind: "locked"; pending: Row[] }
	/** The report is no longer submitted: decided, returned or withdrawn meanwhile. */
	| { kind: "settled" }
	/**
	 * Every attempt found the request it waited for decided while a newer one
	 * (a next chain stage, a transfer) took its place: the submission is moving
	 * under concurrent decisions, so it is not withdrawn now.
	 */
	| { kind: "moving" }
	/** Still submitted, but no request of it is pending at all: inconsistent lifecycle data. */
	| { kind: "missing" };

export interface PendingReportRequestReads<Row> {
	/** The report's pending requests, locked `FOR UPDATE`. */
	lockPending: () => PromiseLike<Row[]>;
	/** Whether the report is still submitted (a fresh read). */
	isSubmitted: () => Promise<boolean>;
	/** Whether any request of the report is pending now (a fresh, unlocked read). */
	anyPending: () => Promise<boolean>;
}

export const PENDING_REPORT_REQUEST_ATTEMPTS = 3;

export async function searchPendingReportRequest<Row>(
	reads: PendingReportRequestReads<Row>,
	attempts: number = PENDING_REPORT_REQUEST_ATTEMPTS,
): Promise<PendingReportRequestSearch<Row>> {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const pending = await reads.lockPending();
		if (pending.length > 0) return { kind: "locked", pending };
		if (!(await reads.isSubmitted())) return { kind: "settled" };
		// A committed decision either settles the report or leaves a newer
		// pending request in the same commit; anything else is not a race.
		if (!(await reads.anyPending())) return { kind: "missing" };
	}
	return { kind: "moving" };
}
