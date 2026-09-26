import "server-only";

import { db } from "@/db";
import {
	acquireAdoptionGate,
	acquireEmployeeCoordination,
	acquireOrganizationConfigurationGuard,
	acquireUserConfigurationAccessGuards,
	readAppendAdmission,
	sealWorkTransactionScope,
	type WorkTransactionScope,
} from "./work-transaction";

export interface WebClockInTransactionInput {
	organizationId: string;
	employeeId: string;
	userId: string;
}

/**
 * Outer transaction owner for the live web clock-in (#273). Clock-in has no
 * approval participation, so it acquires the shared adoption gate, organization
 * configuration and requester access guards, then the existing exclusive
 * employee key. The organization's append control is read under the adoption
 * gate: no control row, or an inactive one, keeps the legacy head selection.
 */
export async function withWebClockInTransaction<T>(
	input: WebClockInTransactionInput,
	operation: (scope: WorkTransactionScope) => Promise<T>,
): Promise<T> {
	return db.transaction(async (transaction) => {
		await acquireAdoptionGate(transaction, input.organizationId);
		const admission = await readAppendAdmission(transaction, input.organizationId);
		await acquireOrganizationConfigurationGuard(transaction, input.organizationId);
		await acquireUserConfigurationAccessGuards(transaction, [input.userId]);
		await acquireEmployeeCoordination(transaction, [input.employeeId]);

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
