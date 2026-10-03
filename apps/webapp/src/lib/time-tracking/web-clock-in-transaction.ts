import "server-only";

import { runWorkTransaction, type WorkRoute, type WorkTransactionScope } from "./work-transaction";

export interface WebClockInTransactionInput {
	organizationId: string;
	employeeId: string;
	userId: string;
}

/** The requester's access and the clocking employee, who is also the only write target. */
function routeWebClockIn(input: WebClockInTransactionInput): WorkRoute {
	return {
		users: [input.userId],
		employees: [input.employeeId],
		writeTargets: [input.employeeId],
	};
}

/**
 * Work transaction for the live web clock-in (#273). Clock-in has no approval
 * participation, so the coordinator takes the shared adoption gate (reading the
 * append control under it), organization configuration and requester access
 * guards, then the existing exclusive employee key.
 */
export function withWebClockInTransaction<T>(
	input: WebClockInTransactionInput,
	operation: (scope: WorkTransactionScope) => Promise<T>,
): Promise<T> {
	return runWorkTransaction(
		{ organizationId: input.organizationId, route: async () => routeWebClockIn(input) },
		operation,
	);
}
