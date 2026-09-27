import "server-only";

import { and, eq, or } from "drizzle-orm";
import { employee } from "@/db/schema";
import {
	runWorkTransaction,
	type WorkRoute,
	type WorkTransactionClient,
	type WorkTransactionScope,
} from "./work-transaction";

export interface CompletedWorkTransactionInput {
	organizationId: string;
	/** The employee who owns the work. */
	employeeId: string;
	/**
	 * The authenticated human acting, or null for a system process acting on the
	 * owner's work (the automatic break adjustment, #305), which routes only the owner.
	 */
	actorUserId: string | null;
}

/**
 * The owner's user and every employee row the amendment's authorization path
 * locks: the owner and each of the actor's employee records in the organization.
 * A system actor routes the owner alone. Only the owner's work is written.
 */
export async function routeCompletedWork(
	transaction: WorkTransactionClient,
	input: CompletedWorkTransactionInput,
): Promise<WorkRoute> {
	const { actorUserId } = input;
	const rows = await transaction
		.select({ id: employee.id, userId: employee.userId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				actorUserId === null
					? eq(employee.id, input.employeeId)
					: or(eq(employee.id, input.employeeId), eq(employee.userId, actorUserId)),
			),
		);
	const userIds = rows.map(({ userId }) => userId);
	return {
		users: actorUserId === null ? userIds : [actorUserId, ...userIds],
		employees: [input.employeeId, ...rows.map(({ id }) => id)],
		writeTargets: [input.employeeId],
	};
}

/**
 * Work transaction for direct completed-work amendments (#286). These writers
 * route no approvals: the coordinator takes the adoption gate, the shared
 * organization configuration guard, the routed users and employees, and hands
 * the operation a scope that may write only the owner's work.
 *
 * Legacy organizations run their unchanged writes inside the same transaction,
 * so an adoption mode change can never interleave with a started write.
 */
export function withCompletedWorkTransaction<T>(
	input: CompletedWorkTransactionInput,
	operation: (scope: WorkTransactionScope) => Promise<T>,
): Promise<T> {
	return runWorkTransaction(
		{ organizationId: input.organizationId, route: (db) => routeCompletedWork(db, input) },
		operation,
	);
}
