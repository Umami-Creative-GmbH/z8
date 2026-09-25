/**
 * The #264 organization configuration guard (rank 3). Fresh manual submissions
 * hold it shared while they read organization configuration; writers of that
 * configuration (holidays, blocking categories, change policies) hold it
 * exclusively. Writers take nothing ranked earlier.
 */
import { sql } from "drizzle-orm";
import type { db } from "@/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Advisory key text; locks use `hashtextextended(key, 0)`. */
export function organizationConfigurationGuardKey(organizationId: string) {
	return JSON.stringify(["work-organization-configuration", organizationId]);
}

export async function acquireExclusiveOrganizationConfigurationGuard(
	transaction: Pick<Transaction, "execute">,
	organizationId: string,
) {
	await transaction.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${organizationConfigurationGuardKey(organizationId)}, 0))`,
	);
}

/**
 * Runs an organization configuration mutation in its own transaction under the
 * exclusive guard, taken before its first read or write and held until commit.
 * In-flight fresh manual submissions finish on the prior configuration; later
 * ones read the committed change.
 */
export function mutateOrganizationConfiguration<T>(
	client: Pick<typeof db, "transaction">,
	organizationId: string,
	mutation: (transaction: Transaction) => Promise<T>,
): Promise<T> {
	return client.transaction(async (transaction) => {
		await acquireExclusiveOrganizationConfigurationGuard(transaction, organizationId);
		return mutation(transaction);
	});
}
