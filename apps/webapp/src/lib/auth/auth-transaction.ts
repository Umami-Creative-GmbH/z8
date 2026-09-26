/**
 * The PostgreSQL transaction behind Better Auth's own transactions (#314).
 *
 * Better Auth mutations run through its adapter, which exposes no SQL, so a
 * membership, role or SCIM writer cannot take the #264 configuration/access
 * guards on the adapter itself. The drizzle client handed to `drizzleAdapter`
 * is wrapped instead: every transaction Better Auth opens publishes its drizzle
 * transaction for exactly as long as the transaction callback runs. Hooks and
 * callbacks inside that transaction take their guards on the same connection
 * and in the same commit as the Better Auth write.
 *
 * `runCoordinatedAuthMutation` opens such a transaction around a whole Better
 * Auth call, so endpoints that would otherwise write outside a transaction
 * (member role updates, removals, invitation acceptance) commit their write
 * together with the guard their before-hook took.
 *
 * While a transaction is published, the wrapped client runs every query on it
 * and a transaction opened on it joins it (#359). Better Auth's HTTP handler
 * resets its adapter context to the base adapter (`runWithAdapter`), so over
 * `/api/auth` its writes reach this client rather than the transaction
 * adapter; without the rerouting they would commit on their own. For the same
 * reason Better Auth's `queueAfterTransactionHook` runs at once there: work
 * that must wait for the commit uses `queueAfterAuthTransactionCommit`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { runWithTransaction } from "@better-auth/core/context";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import type { BetterAuthOptions } from "better-auth";
import type { db } from "@/db";

export type AuthTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TransactionalDatabase = {
	transaction: (
		// biome-ignore lint/suspicious/noExplicitAny: mirrors drizzle's generic transaction signature.
		callback: (transaction: any) => Promise<any>,
		// biome-ignore lint/suspicious/noExplicitAny: drizzle's transaction config differs per driver.
		config?: any,
	) => Promise<unknown>;
};

type CapturedTransaction = {
	transaction: AuthTransaction;
	active: boolean;
	afterCommit: (() => Promise<void>)[];
};

const capturedTransactions = new AsyncLocalStorage<CapturedTransaction>();

export class UncoordinatedAuthMutationError extends Error {
	constructor(operation: string) {
		super(`${operation} must run inside a coordinated auth transaction`);
		this.name = "UncoordinatedAuthMutationError";
	}
}

/**
 * Wraps the drizzle client given to Better Auth so its transactions are
 * published, and so it runs on the published transaction while one is active.
 */
export function captureAuthTransactions<T extends TransactionalDatabase>(database: T): T {
	const transaction: TransactionalDatabase["transaction"] = async (callback, config) => {
		const active = currentAuthTransaction();
		if (active) return callback(active);
		const afterCommit: CapturedTransaction["afterCommit"] = [];
		const result = await database.transaction((drizzleTransaction) => {
			const captured: CapturedTransaction = {
				transaction: drizzleTransaction,
				active: true,
				afterCommit,
			};
			return capturedTransactions.run(captured, async () => {
				try {
					return await callback(drizzleTransaction);
				} finally {
					captured.active = false;
				}
			});
		}, config);
		for (const work of afterCommit) await work();
		return result;
	};

	return new Proxy(database, {
		get(target, property) {
			if (property === "transaction") return transaction;
			const active = currentAuthTransaction();
			const source = active && property in active ? active : target;
			const value = Reflect.get(source, property, source);
			return typeof value === "function" ? value.bind(source) : value;
		},
	});
}

/** The drizzle transaction of the Better Auth transaction running here, if any. */
export function currentAuthTransaction(): AuthTransaction | null {
	const captured = capturedTransactions.getStore();
	return captured?.active ? captured.transaction : null;
}

/**
 * Runs `work` once the published transaction commits, or at once outside one.
 * Rolled-back transactions drop their queued work.
 */
export async function queueAfterAuthTransactionCommit(work: () => Promise<void>): Promise<void> {
	const captured = capturedTransactions.getStore();
	if (!captured?.active) return work();
	captured.afterCommit.push(work);
}

/** Fails closed: an auth mutation never commits without its protection. */
export function requireAuthTransaction(operation: string): AuthTransaction {
	const transaction = currentAuthTransaction();
	if (!transaction) throw new UncoordinatedAuthMutationError(operation);
	return transaction;
}

/** The part of Better Auth's context (`auth.$context`) a coordinated mutation needs. */
export type CoordinatedAuthContext<Options extends BetterAuthOptions = BetterAuthOptions> =
	| PromiseLike<{ adapter: DBAdapter<Options> }>
	| { adapter: DBAdapter<Options> };

/** Runs a Better Auth call inside one Better Auth (and so captured) transaction. */
export async function runCoordinatedAuthMutation<T, Options extends BetterAuthOptions>(
	authContext: CoordinatedAuthContext<Options>,
	mutation: () => Promise<T>,
): Promise<T> {
	const { adapter } = await authContext;
	return runWithTransaction(adapter, mutation);
}
