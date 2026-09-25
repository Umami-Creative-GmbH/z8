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
 * Exclusive counterpart of the shared organization configuration guard, for a
 * writer of facts that fresh manual preparation reads (#258 §4). Take it first
 * in the writer's own transaction, before its target validation and first
 * dependent write, and hold it to commit: never after a write, never as an
 * after-commit hook, and never as an upgrade from the shared guard.
 */
export async function acquireOrganizationConfigurationMutationGuard(
	transaction: Pick<Transaction, "execute">,
	organizationId: string,
) {
	await transaction.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${organizationConfigurationKey(organizationId)}, 0))`,
	);
}

/**
 * Runs one organization configuration mutation in its own transaction under
 * exclusive configuration protection. Validation that decides whether the
 * write is allowed belongs inside `write`, so it serializes with preparation.
 */
export async function withOrganizationConfigurationMutation<T>(
	client: Pick<typeof db, "transaction">,
	organizationId: string,
	write: (transaction: Transaction) => Promise<T>,
): Promise<T> {
	return client.transaction(async (transaction) => {
		await acquireOrganizationConfigurationMutationGuard(transaction, organizationId);
		return write(transaction);
	});
}
