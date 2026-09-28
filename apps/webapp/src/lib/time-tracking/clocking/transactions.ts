import "server-only";

import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
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
import type {
	SealedWorkTransactionScope,
	WorkRoute,
	WorkTransactionScope,
} from "../work-transaction";

/** The one departure an enlisted adapter runs clock commands for. */
export type DepartureEnlistment = {
	organizationId: string;
	employeeId: string;
	departureId: string;
};

/**
 * The transactions port. The coordinated adapter owns the work transaction; the
 * enlisted adapter runs inside a departure's (#485).
 */
export interface ClockTransactions {
	/**
	 * Set only by the enlisted adapter. A departure principal runs only through
	 * the adapter enlisted for its departure, and nothing else runs there (#476
	 * decision 20).
	 */
	readonly enlistment?: DepartureEnlistment;
	/** A closure's work transaction, with its approval participation. */
	run<T>(
		scope: WebClockOutTransactionInput,
		operation: (context: WorkTransactionContext) => Promise<T>,
	): Promise<T>;
	/** A start's work transaction; starts have no approval participation. */
	start<T>(
		scope: WebClockInTransactionInput,
		operation: (scope: SealedWorkTransactionScope) => Promise<T>,
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

function refuseApproval(): never {
	throw new Error("A departure clock-out does not participate in approval");
}

/**
 * A departure's closure routes no approval and replays no approval submission:
 * reaching into it is a protocol error, as a live clock-out's routing is.
 */
const noApproval = new Proxy({} as ApprovalWorkflowTransactionContext, { get: refuseApproval });

/** The closure's context over one savepoint of the departure's sealed scope. */
function enlistedContext(
	savepoint: WorkTransactionScope<WorkRoute, unknown>,
): WorkTransactionContext {
	const {
		restart: _restart,
		savepoint: _savepoint,
		route: _route,
		approval: _approval,
		...sealed
	} = savepoint;
	return Object.freeze({
		...sealed,
		approval: noApproval,
		assertParticipant: refuseApproval,
		assertApprovalPolicy: refuseApproval,
	});
}

/**
 * Enlists in a departure's work transaction (#476 decision 17). The departure
 * already holds every guard its clock-out needs, so each closure step runs in a
 * savepoint of its sealed scope and takes none: a step that throws rolls back
 * only its own writes, and whatever commits, commits with the departure.
 * Departures never start work.
 */
export function enlistedTransactions(
	scope: WorkTransactionScope<WorkRoute, unknown>,
	enlistment: DepartureEnlistment,
): ClockTransactions {
	return {
		enlistment,
		run(input, operation) {
			if (
				input.organizationId !== enlistment.organizationId ||
				input.employeeId !== enlistment.employeeId
			) {
				return Promise.reject(new Error("Clock command is outside its departure"));
			}
			return scope.savepoint((savepoint) => operation(enlistedContext(savepoint)));
		},
		start: () => Promise.reject(new Error("A departure only closes work")),
	};
}
