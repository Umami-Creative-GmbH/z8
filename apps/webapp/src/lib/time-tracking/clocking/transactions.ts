import "server-only";

import { createOrdinaryApprovalRuntime } from "../ordinary-approval-runtime";
import {
	type WebClockOutTransactionInput,
	type WorkTransactionContext,
	withWebClockOutTransaction,
} from "../web-clock-out-transaction";

/**
 * The transactions port. A coordinated adapter owns the work transaction; an
 * enlisted one (departure) will run inside a caller's sealed work transaction.
 */
export interface ClockTransactions {
	readonly kind: "coordinated";
	run<T>(
		scope: WebClockOutTransactionInput,
		operation: (context: WorkTransactionContext) => Promise<T>,
	): Promise<T>;
}

/** The module owns each work transaction, under the #264 acquisition protocol. */
export function coordinatedTransactions(): ClockTransactions {
	return {
		kind: "coordinated",
		run: (scope, operation) =>
			withWebClockOutTransaction(scope, createOrdinaryApprovalRuntime, operation),
	};
}
