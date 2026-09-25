/**
 * Shared outer work-transaction scope and the #264 acquisition protocol keys.
 * Coordinators acquire, in order: the organization adoption gate, approval gates,
 * organization configuration, sorted user configuration/access, sorted employee
 * coordination, then source identities and rows. All advisory locks are
 * transaction-scoped with hash seed zero.
 */
import { eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { timeEntryAppendControl } from "@/db/schema/time-entry-append";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WorkTransactionClient = Pick<
	Transaction,
	"execute" | "query" | "select" | "insert" | "update" | "delete"
>;

const protectedTransaction = Symbol("protected work transaction");

/**
 * `legacy` keeps each writer's established head selection. `append` admits fresh
 * entries from evidence through the internal append collaborator; it is read
 * from the organization's append control under the shared adoption gate.
 */
export type WorkTransactionAdmission = "legacy" | "append";

/** Trusted server composition only; no transaction/savepoint or adoption upgrade capability. */
export interface WorkTransactionScope {
	readonly [protectedTransaction]: true;
	readonly db: WorkTransactionClient;
	readonly admission: WorkTransactionAdmission;
	assertEmployee(organizationId: string, employeeId: string): void;
}

/** For the outer transaction coordinators only; ordinary callers receive a scope. */
export function sealWorkTransactionScope<T extends object>(
	scope: T,
): T & { readonly [protectedTransaction]: true } {
	return Object.freeze({ ...scope, [protectedTransaction]: true as const });
}

export async function acquireAdoptionGate(
	transaction: Pick<Transaction, "execute">,
	organizationId: string,
) {
	await transaction.execute(
		sql`select pg_advisory_xact_lock_shared(hashtextextended(${JSON.stringify(["completed-work-adoption", organizationId])}, 0))`,
	);
}

/**
 * The organization's append admission, read under the shared adoption gate so an
 * exclusive adoption holder drains this transaction before a mode change is
 * visible. No control row, or an inactive one, keeps legacy head selection.
 */
export async function readAppendAdmission(
	transaction: Pick<Transaction, "select">,
	organizationId: string,
): Promise<WorkTransactionAdmission> {
	const [control] = await transaction
		.select({ mode: timeEntryAppendControl.mode })
		.from(timeEntryAppendControl)
		.where(eq(timeEntryAppendControl.organizationId, organizationId))
		.limit(1);
	return control?.mode === "active" ? "append" : "legacy";
}

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
 * writer of facts that fresh manual preparation reads (#258 §4, #315). Take it
 * first in the writer's own transaction, before its target validation and first
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

export async function acquireUserConfigurationAccessGuards(
	transaction: Pick<Transaction, "execute">,
	userIds: readonly string[],
) {
	for (const userId of [...new Set(userIds)].sort()) {
		await transaction.execute(
			sql`select pg_advisory_xact_lock_shared(hashtextextended(${JSON.stringify(["work-user-configuration-access", userId])}, 0))`,
		);
	}
}

/** Exclusive originating-source identity (#264 step 6), e.g. a provider record. */
export async function acquireSourceIdentity(
	transaction: Pick<Transaction, "execute">,
	identity: readonly string[],
) {
	await transaction.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(identity)}, 0))`,
	);
}

/** Reuses the established exclusive employee key shared by every clocking writer. */
export async function acquireEmployeeCoordination(
	transaction: Pick<Transaction, "execute">,
	employeeIds: readonly string[],
) {
	for (const employeeId of [...new Set(employeeIds)].sort()) {
		await transaction.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${employeeId}, 0))`,
		);
	}
}
