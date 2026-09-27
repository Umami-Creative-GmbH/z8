import "server-only";

import { createOrdinaryApprovalRuntime } from "../ordinary-approval-runtime";
import {
	type WebClockOutTransactionInput,
	type WorkTransactionContext,
	withWebClockOutTransaction,
} from "../web-clock-out-transaction";

/**
 * The transactions port. The coordinated adapter owns the work transaction; the
 * enlisted adapter for departures (#485) will run inside a caller's.
 */
export interface ClockTransactions {
	run<T>(
		scope: WebClockOutTransactionInput,
		operation: (context: WorkTransactionContext) => Promise<T>,
	): Promise<T>;
}

/** The module owns each work transaction, under the #264 acquisition protocol. */
export function coordinatedTransactions(): ClockTransactions {
	return {
		run: (scope, operation) =>
			withWebClockOutTransaction(scope, createOrdinaryApprovalRuntime, operation),
	};
}
