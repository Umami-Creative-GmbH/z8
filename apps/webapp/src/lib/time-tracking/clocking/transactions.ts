import "server-only";

import { createOrdinaryApprovalRuntime } from "../ordinary-approval-runtime";
import {
	type WebClockInTransactionInput,
	withWebClockInTransaction,
} from "../web-clock-in-transaction";
import {
	type WebClockOutTransactionInput,
	type WorkTransactionContext,
	withWebClockOutTransaction,
} from "../web-clock-out-transaction";
import type { WorkTransactionScope } from "../work-transaction";

/**
 * The transactions port. The coordinated adapter owns the work transaction; the
 * enlisted adapter for departures (#485) will run inside a caller's.
 */
export interface ClockTransactions {
	/** A closure's work transaction, with its approval participation. */
	run<T>(
		scope: WebClockOutTransactionInput,
		operation: (context: WorkTransactionContext) => Promise<T>,
	): Promise<T>;
	/** A start's work transaction; starts have no approval participation. */
	start<T>(
		scope: WebClockInTransactionInput,
		operation: (scope: WorkTransactionScope) => Promise<T>,
	): Promise<T>;
}

/** The module owns each work transaction, under the #264 acquisition protocol. */
export function coordinatedTransactions(): ClockTransactions {
	return {
		run: (scope, operation) =>
			withWebClockOutTransaction(scope, createOrdinaryApprovalRuntime, operation),
		start: (scope, operation) => withWebClockInTransaction(scope, operation),
	};
}
