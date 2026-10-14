import "server-only";

/**
 * Work records on the Approvals finalizer's database handle (ADR 0010, #1221).
 * Approval finalizers (the terminal break today) reach completed work with the
 * approval transaction's handle, not with a scope. The handle is accepted:
 *
 * - inside a work transaction registered for it, as that transaction's scope;
 * - without one, only in a legacy organization whose caller already holds the
 *   employee locks, as a legacy scope for that employee alone.
 *
 * Anything else throws: an adopted organization's work is changed only under
 * the coordinator (ADR 0001). Work records still takes no guard of its own.
 */
import {
	readAppendAdmission,
	type SealedWorkTransactionScope,
	uncoordinatedLegacyScope,
	type WorkTransactionClient,
	WorkTransactionProtocolViolation,
	workTransactionScopeFor,
} from "../work-transaction";

export async function workRecordScopeForFinalizer(
	handle: WorkTransactionClient,
	key: { organizationId: string; employeeId: string },
): Promise<SealedWorkTransactionScope> {
	const registered = workTransactionScopeFor(handle);
	if (registered) {
		if (registered.db !== handle) {
			throw new WorkTransactionProtocolViolation("a finalizer handle sealed for another client");
		}
		registered.assertEmployee(key.organizationId, key.employeeId);
		return registered;
	}
	if ((await readAppendAdmission(handle, key.organizationId)) === "append") {
		throw new WorkTransactionProtocolViolation(
			"the Approvals finalizer's handle without a work transaction in an adopted organization",
		);
	}
	return uncoordinatedLegacyScope(handle, key);
}
