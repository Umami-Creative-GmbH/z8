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

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
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

const scopesByTransaction = new WeakMap<object, WorkTransactionScope>();

/**
 * For the outer transaction coordinators only; ordinary callers receive a scope.
 * The sealed scope is also registered for its transaction client, so trusted
 * collaborators that the approval engine calls with only that client (#301
 * correction finalization and cancellation) can find the coordinated scope.
 */
export function sealWorkTransactionScope<T extends object>(
	scope: T,
): T & { readonly [protectedTransaction]: true } {
	const sealed = Object.freeze({ ...scope, [protectedTransaction]: true as const });
	if (isWorkTransactionScope(sealed)) scopesByTransaction.set(sealed.db, sealed);
	return sealed;
}

function isWorkTransactionScope(value: object): value is WorkTransactionScope {
	const candidate = value as Partial<WorkTransactionScope>;
	return (
		typeof candidate.db === "object" &&
		candidate.db !== null &&
		(candidate.admission === "legacy" || candidate.admission === "append") &&
		typeof candidate.assertEmployee === "function"
	);
}

/**
 * The coordinated scope sealed for this transaction client, or null when the
 * client was not opened by a work-transaction coordinator.
 */
export function workTransactionScopeFor(client: object): WorkTransactionScope | null {
	return scopesByTransaction.get(client) ?? null;
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

const organizationConfigurationKey = (organizationId: string) =>
	JSON.stringify(["work-organization-configuration", organizationId]);
const userConfigurationAccessKey = (userId: string) =>
	JSON.stringify(["work-user-configuration-access", userId]);

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

export async function acquireUserConfigurationAccessGuards(
	transaction: Pick<Transaction, "execute">,
	userIds: readonly string[],
) {
	for (const userId of [...new Set(userIds)].sort()) {
		await transaction.execute(
			sql`select pg_advisory_xact_lock_shared(hashtextextended(${userConfigurationAccessKey(userId)}, 0))`,
		);
	}
}

/**
 * Exclusive user configuration/access protection for a writer of a user's
 * manual dependencies (#313), sorted, taken after any organization protection
 * and before the writer's first dependent mutation; never upgrade from shared.
 */
export async function acquireExclusiveUserConfigurationAccessGuards(
	transaction: Pick<Transaction, "execute">,
	userIds: readonly string[],
) {
	for (const userId of [...new Set(userIds)].sort()) {
		await transaction.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${userConfigurationAccessKey(userId)}, 0))`,
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
