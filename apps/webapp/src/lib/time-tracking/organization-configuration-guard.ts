/**
 * The #264 organization configuration guard (rank 3). Fresh manual preparation
 * holds it shared while it reads organization configuration; writers of that
 * configuration hold it exclusively. It imports no schema, so route handlers
 * and actions can take it without loading the work-transaction module.
 */
import { sql } from "drizzle-orm";
import type { db } from "@/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The advisory key shared by manual preparation (shared) and configuration writers (exclusive). */
function organizationConfigurationKey(organizationId: string) {
	return JSON.stringify(["work-organization-configuration", organizationId]);
}

export async function acquireOrganizationConfigurationGuard(
	transaction: Pick<Transaction, "execute">,
	organizationId: string,
) {
	await transaction.execute(
		sql`select pg_advisory_xact_lock_shared(hashtextextended(${organizationConfigurationKey(organizationId)}, 0))`,
	);
}

/**
 * Exclusive organization configuration protection for a writer of a manual
 * dependency, held from before its first dependent mutation through commit. It
 * drains and fences every holder of the shared guard; never upgrade from shared.
 */
export async function acquireExclusiveOrganizationConfigurationGuard(
	transaction: Pick<Transaction, "execute">,
	organizationId: string,
) {
	await transaction.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${organizationConfigurationKey(organizationId)}, 0))`,
	);
}

/**
 * Runs one organization configuration mutation in its own transaction under
 * exclusive configuration protection (#315). Validation that decides whether the
 * write is allowed belongs inside `write`, so it serializes with preparation.
 */
export async function withOrganizationConfigurationMutation<T>(
	client: Pick<typeof db, "transaction">,
	organizationId: string,
	write: (transaction: Transaction) => Promise<T>,
): Promise<T> {
	return client.transaction(async (transaction) => {
		await acquireExclusiveOrganizationConfigurationGuard(transaction, organizationId);
		return write(transaction);
	});
}
