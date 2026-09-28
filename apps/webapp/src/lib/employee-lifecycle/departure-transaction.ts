/**
 * The employee departure as a work transaction (#492, S6 of #477). Every
 * transaction that runs `executeDepartureInTransaction` opens here, so the
 * coordinator takes the acquisition protocol in rank order: the shared
 * adoption gate, the exclusive configuration/access guard of the employee's
 * user (a departure changes access and active state, #313), the employee key,
 * then the organization row as the rank-7 row lock. The organization
 * configuration guard stays `none` (#477 decision 9). The departing employee is
 * the only write target.
 */
import {
	runWorkTransaction,
	type WorkPlan,
	type WorkRoute,
	type WorkTransactionDatabase,
} from "@/lib/time-tracking/work-transaction";
import { lifecycleUserIds, lockLifecycleOrganization } from "./locks";
import type { DepartureScope } from "./types";

export type DepartureTarget = { organizationId: string; employeeId: string };

export function departureWorkPlan(
	database: WorkTransactionDatabase,
	target: DepartureTarget,
): WorkPlan<WorkRoute> {
	return {
		organizationId: target.organizationId,
		database,
		route: async (db) => ({
			users: await lifecycleUserIds(db, target.organizationId, target.employeeId),
			employees: [target.employeeId],
			writeTargets: [target.employeeId],
			// Deactivating work policy assignments needs no configuration guard (time-tracking ADR 0003).
			guards: { organization: "none", users: "exclusive" },
		}),
		lockRows: (db) => lockLifecycleOrganization(db, target.organizationId),
	};
}

/**
 * Runs `operation` in a departure work transaction of `database`. It may run
 * up to 3 times, so it must have no effects outside the transaction.
 */
export function runDepartureTransaction<T>(
	database: WorkTransactionDatabase,
	target: DepartureTarget,
	operation: (scope: DepartureScope) => Promise<T>,
): Promise<T> {
	return runWorkTransaction(departureWorkPlan(database, target), operation);
}
