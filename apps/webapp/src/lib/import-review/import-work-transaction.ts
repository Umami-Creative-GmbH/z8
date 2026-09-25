import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
	acquireAdoptionGate,
	acquireEmployeeCoordination,
	acquireOrganizationConfigurationGuard,
	acquireUserConfigurationAccessGuards,
	readAppendAdmission,
	sealWorkTransactionScope,
	type WorkTransactionScope,
} from "@/lib/time-tracking/work-transaction";

export interface ReviewedImportTransactionInput {
	organizationId: string;
	/** Routed from the staged row before the transaction; the caller revalidates it. */
	employeeId: string;
	importerUserId: string;
	/** Provider source identity (`importedWorkSourceKey`). */
	sourceKey: string;
}

/**
 * Outer transaction owner for committing one reviewed work import row (#284).
 * Imports have no approval participation. Acquisition follows the #264 order:
 *
 * 1. the shared adoption gate, then the organization's append control under it;
 * 2. shared organization configuration;
 * 3. shared importer configuration/access;
 * 4. the existing exclusive employee key `hashtextextended(employeeId, 0)`, which
 *    replaces the import worker's former `organization:employee` key;
 * 5. the exclusive provider source identity, so the same source imported through
 *    two batches serializes regardless of its employee mapping.
 *
 * The operation then claims the staging row and reads authoritative rows. A
 * changed routed scope must throw and restart the whole transaction; nothing here
 * acquires an earlier-ranked resource late.
 */
export async function withReviewedImportTransaction<T>(
	input: ReviewedImportTransactionInput,
	operation: (scope: WorkTransactionScope) => Promise<T>,
): Promise<T> {
	return db.transaction(async (transaction) => {
		await acquireAdoptionGate(transaction, input.organizationId);
		const admission = await readAppendAdmission(transaction, input.organizationId);
		await acquireOrganizationConfigurationGuard(transaction, input.organizationId);
		await acquireUserConfigurationAccessGuards(transaction, [input.importerUserId]);
		await acquireEmployeeCoordination(transaction, [input.employeeId]);
		await transaction.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
				"reviewed-import-source",
				input.organizationId,
				input.sourceKey,
			])}, 0))`,
		);

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
