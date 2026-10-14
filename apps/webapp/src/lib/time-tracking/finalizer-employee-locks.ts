/**
 * The employee locks an Approvals finalizer holds before it changes completed
 * work outside the coordinator (#1221, #1227). Under the owner's coordinated
 * work transaction they are already held. Another approval runtime (a legacy
 * engine decision, an assignment activation after a reassignment) takes the
 * established employee locks here, before any row lock, so work records
 * accepts its database handle in a legacy organization
 * (`workRecordScopeForFinalizer`); an adopted organization stays refused there.
 */
import { type WorkTransactionClient, workTransactionScopeFor } from "./work-transaction";
import {
	employeeCoordinationGuard,
	holdGuard,
	lockGuard,
	sourceIdentityGuard,
} from "./work-transaction/ranks";

export async function holdFinalizerEmployeeLocks(
	db: WorkTransactionClient,
	key: { organizationId: string; employeeId: string },
): Promise<void> {
	if (workTransactionScopeFor(db)) return;
	await holdGuard(db, employeeCoordinationGuard(key.employeeId));
	await lockGuard(db, sourceIdentityGuard([key.organizationId, key.employeeId]));
}
