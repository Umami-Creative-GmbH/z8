/**
 * The ranks of the acquisition protocol, their guards, and the per-transaction
 * ledger that makes a wrong order throw in every environment (#477 decision 2).
 *
 * It imports no schema, so approvals, authorization, lifecycle and route
 * handlers can record into the ledger without loading the work-transaction
 * module. All guards are transaction-scoped advisory locks with hash seed zero.
 */
import { sql } from "drizzle-orm";
import type { db } from "@/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type GuardClient = Pick<Transaction, "execute">;

/** A guard's position in the acquisition protocol; lower ranks are taken first. */
export const Rank = {
	adoptionGate: 1,
	approvalWriteGate: 2,
	organizationConfiguration: 3,
	userConfigurationAccess: 4,
	employeeCoordination: 5,
	sourceIdentity: 6,
	rows: 7,
} as const;
export type Rank = (typeof Rank)[keyof typeof Rank];

export type GuardMode = "shared" | "exclusive";

export interface Guard {
	readonly rank: Rank;
	/** The advisory key text, hashed with `hashtextextended(key, 0)`. */
	readonly key: string;
	readonly mode: GuardMode;
}

export function adoptionGate(organizationId: string, mode: GuardMode = "shared"): Guard {
	return {
		rank: Rank.adoptionGate,
		key: JSON.stringify(["completed-work-adoption", organizationId]),
		mode,
	};
}

/**
 * The #264 organization configuration guard (rank 3). Fresh manual preparation
 * holds it shared while it reads organization configuration; writers of that
 * configuration hold it exclusively.
 */
export function organizationConfigurationGuard(
	organizationId: string,
	mode: GuardMode = "shared",
): Guard {
	return {
		rank: Rank.organizationConfiguration,
		key: JSON.stringify(["work-organization-configuration", organizationId]),
		mode,
	};
}

export function userConfigurationAccessGuard(userId: string, mode: GuardMode = "shared"): Guard {
	return {
		rank: Rank.userConfigurationAccess,
		key: JSON.stringify(["work-user-configuration-access", userId]),
		mode,
	};
}

/** The established exclusive employee key shared by every clocking writer. */
export function employeeCoordinationGuard(employeeId: string): Guard {
	return { rank: Rank.employeeCoordination, key: employeeId, mode: "exclusive" };
}

/** Exclusive originating-source identity (#264 step 6), e.g. a provider record. */
export function sourceIdentityGuard(identity: readonly string[]): Guard {
	return { rank: Rank.sourceIdentity, key: JSON.stringify(identity), mode: "exclusive" };
}

/**
 * A breach of the acquisition protocol. It is a programming error, so it throws
 * in every environment and is never retried.
 */
export class WorkTransactionProtocolViolation extends Error {
	constructor(message: string) {
		super(`Work transaction protocol violation: ${message}`);
		this.name = "WorkTransactionProtocolViolation";
	}
}

type Lock = (client: GuardClient, guard: Guard) => Promise<void>;

/** Takes the guard's advisory lock without recording it. */
export async function lockGuard(client: GuardClient, guard: Guard): Promise<void> {
	await client.execute(
		guard.mode === "shared"
			? sql`select pg_advisory_xact_lock_shared(hashtextextended(${guard.key}, 0))`
			: sql`select pg_advisory_xact_lock(hashtextextended(${guard.key}, 0))`,
	);
}

class GuardLedger {
	private readonly held = new Map<string, Guard>();
	private highest = 0;
	private routing = 0;
	private savepoints = 0;

	constructor(readonly lock: Lock) {}

	/** Records the guard; true when it is newly held and must still be locked. */
	record(guard: Guard): boolean {
		const describe = `rank ${guard.rank} ${guard.mode} guard ${guard.key}`;
		if (this.routing > 0) throw new WorkTransactionProtocolViolation(`${describe} during routing`);
		if (this.savepoints > 0) {
			throw new WorkTransactionProtocolViolation(`${describe} inside a savepoint`);
		}
		const id = `${guard.rank}\u0000${guard.key}`;
		const held = this.held.get(id);
		if (held) {
			if (held.mode === "shared" && guard.mode === "exclusive") {
				throw new WorkTransactionProtocolViolation(`${describe} upgrades a shared guard`);
			}
			return false;
		}
		if (guard.rank < this.highest) {
			throw new WorkTransactionProtocolViolation(`${describe} after rank ${this.highest}`);
		}
		this.held.set(id, guard);
		this.highest = guard.rank;
		return true;
	}

	holds(rank: Rank): boolean {
		for (const guard of this.held.values()) if (guard.rank === rank) return true;
		return false;
	}

	async during<T>(phase: "routing" | "savepoints", work: () => Promise<T>): Promise<T> {
		this[phase] += 1;
		try {
			return await work();
		} finally {
			this[phase] -= 1;
		}
	}
}

const ledgers = new WeakMap<object, GuardLedger>();

function ledgerFor(client: object): GuardLedger {
	let ledger = ledgers.get(client);
	if (!ledger) {
		ledger = new GuardLedger(lockGuard);
		ledgers.set(client, ledger);
	}
	return ledger;
}

/**
 * Takes a guard for a writer outside the coordinator: records it in the
 * transaction's ledger, then locks. A held guard in the same or a weaker mode
 * is not taken again. `client` must be a transaction, never a long-lived
 * database handle, since the ledger lives as long as the client.
 */
export async function holdGuard(client: GuardClient, guard: Guard): Promise<void> {
	const ledger = ledgerFor(client);
	if (ledger.record(guard)) await ledger.lock(client, guard);
}

/** Records a guard its owner locks itself, such as the approval write gate (rank 2). */
export function recordGuard(client: object, rank: Rank, key: string, mode: GuardMode): void {
	ledgerFor(client).record({ rank, key, mode });
}

/**
 * Coordinator internals: a fresh ledger for a transaction the coordinator
 * opened, with the lock its adapter takes (the fake records instead).
 */
export function openLedger(client: object, lock: Lock): void {
	ledgers.set(client, new GuardLedger(lock));
}

/** Coordinator internals: whether the transaction's ledger holds a guard of the rank. */
export function ledgerHolds(client: object, rank: Rank): boolean {
	return ledgerFor(client).holds(rank);
}

/** Coordinator internals: refuses every guard while `work` routes the scope. */
export function duringRouting<T>(client: object, work: () => Promise<T>): Promise<T> {
	return ledgerFor(client).during("routing", work);
}

/**
 * Coordinator internals: refuses every guard inside a savepoint, on the
 * transaction and on the savepoint's own client.
 */
export function insideSavepoint<T>(
	client: object,
	savepoint: object,
	work: () => Promise<T>,
): Promise<T> {
	const ledger = ledgerFor(client);
	if (savepoint !== client) ledgers.set(savepoint, ledger);
	return ledger.during("savepoints", work);
}

/**
 * Inside a work transaction the guard is recorded in its ledger; elsewhere it
 * only locks, because the client may outlive a single transaction (a caller's
 * database handle), and a ledger must never carry guards across transactions.
 */
async function takeConfigurationGuard(client: GuardClient, guard: Guard): Promise<void> {
	if (ledgers.has(client)) await holdGuard(client, guard);
	else await lockGuard(client, guard);
}

export async function acquireOrganizationConfigurationGuard(
	transaction: GuardClient,
	organizationId: string,
) {
	await takeConfigurationGuard(
		transaction,
		organizationConfigurationGuard(organizationId, "shared"),
	);
}

/**
 * Exclusive organization configuration protection for a writer of a manual
 * dependency, held from before its first dependent mutation through commit. It
 * drains and fences every holder of the shared guard; never upgrade from shared.
 */
export async function acquireExclusiveOrganizationConfigurationGuard(
	transaction: GuardClient,
	organizationId: string,
) {
	await takeConfigurationGuard(
		transaction,
		organizationConfigurationGuard(organizationId, "exclusive"),
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
