import "server-only";

import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { WorkTransactionScopeChanged } from "./web-clock-out-resources";
import {
	acquireAdoptionGate,
	acquireEmployeeCoordination,
	acquireOrganizationConfigurationGuard,
	acquireUserConfigurationAccessGuards,
	readAppendAdmission,
	sealWorkTransactionScope,
	type WorkTransactionClient,
	type WorkTransactionScope,
} from "./work-transaction";

export interface CompletedWorkTransactionInput {
	organizationId: string;
	/** The employee who owns the work. */
	employeeId: string;
	/** The authenticated human acting. */
	actorUserId: string;
}

type RoutedScope = { userIds: string[]; employeeIds: string[] };

/**
 * The owner's user and every employee row the amendment's authorization path
 * locks: the owner and each of the actor's employee records in the organization.
 */
async function routeScope(
	transaction: WorkTransactionClient,
	input: CompletedWorkTransactionInput,
): Promise<RoutedScope> {
	const rows = await transaction
		.select({ id: employee.id, userId: employee.userId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				or(eq(employee.id, input.employeeId), eq(employee.userId, input.actorUserId)),
			),
		);
	return {
		userIds: [...new Set([input.actorUserId, ...rows.map(({ userId }) => userId)])].sort(),
		employeeIds: [...new Set([input.employeeId, ...rows.map(({ id }) => id)])].sort(),
	};
}

function sameScope(left: RoutedScope, right: RoutedScope): boolean {
	return (
		left.userIds.join() === right.userIds.join() &&
		left.employeeIds.join() === right.employeeIds.join()
	);
}

/**
 * Outer transaction owner for direct completed-work amendments (#286). These
 * writers route no approvals, so after the shared adoption gate (with the append
 * control read under it) they take the organization configuration guard, the
 * sorted user access guards and the sorted exclusive employee keys, before any
 * row lock. The routed scope is re-read under those locks; a changed scope
 * restarts the transaction instead of acquiring an earlier-ranked lock late.
 *
 * Legacy organizations run their unchanged writes inside the same transaction,
 * so an adoption mode change can never interleave with a started write.
 */
export async function withCompletedWorkTransaction<T>(
	input: CompletedWorkTransactionInput,
	operation: (scope: WorkTransactionScope) => Promise<T>,
): Promise<T> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await runAttempt(input, operation);
		} catch (error) {
			if (!(error instanceof WorkTransactionScopeChanged) || attempt >= 2) throw error;
		}
	}
}

async function runAttempt<T>(
	input: CompletedWorkTransactionInput,
	operation: (scope: WorkTransactionScope) => Promise<T>,
): Promise<T> {
	return db.transaction(async (transaction) => {
		const routed = await routeScope(transaction, input);
		await acquireAdoptionGate(transaction, input.organizationId);
		const admission = await readAppendAdmission(transaction, input.organizationId);
		await acquireOrganizationConfigurationGuard(transaction, input.organizationId);
		await acquireUserConfigurationAccessGuards(transaction, routed.userIds);
		await acquireEmployeeCoordination(transaction, routed.employeeIds);
		if (!sameScope(routed, await routeScope(transaction, input))) {
			throw new WorkTransactionScopeChanged();
		}

		let active = true;
		try {
			return await operation(
				sealWorkTransactionScope({
					db: transaction,
					admission,
					assertEmployee(organizationId: string, employeeId: string) {
						if (!active) throw new Error("Work transaction is no longer active");
						if (organizationId !== input.organizationId || employeeId !== input.employeeId) {
							throw new Error("Employee scope is outside the work transaction");
						}
					},
				}),
			);
		} finally {
			active = false;
		}
	});
}
