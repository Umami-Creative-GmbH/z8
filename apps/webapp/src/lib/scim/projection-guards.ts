/**
 * SCIM projected users' configuration/access guards in sorted order (#429).
 *
 * The SCIM plugin calls `reconcileSCIMProjectedUser` once per projected user,
 * in its own order: a group change follows the request's member order. Guards
 * taken there alone could therefore be taken out of order and deadlock against
 * a manual submission, which takes its shared guards sorted (#264 ranks 3–4).
 *
 * Before projecting, the plugin locks each user's subject aggregate by
 * advancing `scimSubject.revision` (or creating the subject). For every
 * multi-user projection (group changes, domain replay, decommission) it locks
 * all of them first, in ascending user-ID order, for its own deadlock freedom.
 * `guardSCIMSubjectAcquisitions` wraps Better Auth's adapter so that the
 * user's exclusive guard is taken as soon as that lock is held, in the same
 * transaction. The guards thus follow the plugin's sorted subject order and
 * are all held before the first projected write.
 *
 * Nothing is ever locked out of order: a subject below a user already guarded,
 * or a projected user whose guard was not taken with its subject, aborts the
 * whole SCIM transaction (#313's restart semantics, with the SCIM client or
 * recovery retrying, since the plugin owns the transaction).
 */
import type { DBAdapter } from "@better-auth/core/db/adapter";
import type { BetterAuthOptions } from "better-auth";
import { type AuthTransaction, requireAuthTransaction } from "@/lib/auth/auth-transaction";
import { protectAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { acquireExclusiveUserConfigurationAccessGuards } from "@/lib/time-tracking/work-transaction";

const SCIM_SUBJECT_MODEL = "scimSubject";

export class SCIMProjectionGuardOrderError extends Error {
	constructor(userId: string) {
		super(
			`SCIM user ${userId} would be guarded out of sorted order; the SCIM transaction was aborted and must be retried`,
		);
		this.name = "SCIMProjectionGuardOrderError";
	}
}

type GuardedUsers = { userIds: Set<string>; highest: string };

/** Users whose exclusive guard each SCIM transaction took (ascending by construction). */
const guardedUsers = new WeakMap<object, GuardedUsers>();

function recordGuardedUser(transaction: AuthTransaction, userId: string) {
	const guarded = guardedUsers.get(transaction);
	if (!guarded) {
		guardedUsers.set(transaction, { userIds: new Set([userId]), highest: userId });
		return;
	}
	guarded.userIds.add(userId);
	if (userId > guarded.highest) guarded.highest = userId;
}

/** Guards the subject's user once the plugin's write returned the locked subject row. */
async function guardLockedSubject<T>(model: string, lock: Promise<T>): Promise<T> {
	const subject = await lock;
	if (model !== SCIM_SUBJECT_MODEL) return subject;
	const userId = (subject as { userId?: unknown } | null)?.userId;
	if (typeof userId === "string") await guardSubjectUser(userId);
	return subject;
}

async function guardSubjectUser(userId: string) {
	const transaction = requireAuthTransaction("SCIM subject lock");
	const guarded = guardedUsers.get(transaction);
	if (guarded?.userIds.has(userId)) return;
	// Same code-unit order as the plugin's and the guards' `.sort()`.
	if (guarded && guarded.highest > userId) throw new SCIMProjectionGuardOrderError(userId);
	await acquireExclusiveUserConfigurationAccessGuards(transaction, [userId]);
	recordGuardedUser(transaction, userId);
}

type AuthAdapter = DBAdapter<BetterAuthOptions>;

function observeSubjectLocks<Adapter extends Pick<AuthAdapter, "create" | "incrementOne">>(
	adapter: Adapter,
): Adapter {
	return {
		...adapter,
		create: (data: Parameters<AuthAdapter["create"]>[0]) =>
			guardLockedSubject(data.model, adapter.create(data)),
		incrementOne: (data: Parameters<AuthAdapter["incrementOne"]>[0]) =>
			guardLockedSubject(data.model, adapter.incrementOne(data)),
	};
}

/**
 * Wraps Better Auth's database adapter factory so every SCIM subject lock,
 * including those inside Better Auth transactions, takes the user's exclusive
 * configuration/access guard in the same transaction.
 */
export function guardSCIMSubjectAcquisitions<Options extends BetterAuthOptions>(
	factory: (options: Options) => DBAdapter<Options>,
): (options: Options) => DBAdapter<Options> {
	return (options) => {
		const adapter = factory(options);
		return {
			...observeSubjectLocks(adapter),
			transaction: (callback) =>
				adapter.transaction((transactionAdapter) =>
					callback(observeSubjectLocks(transactionAdapter)),
				),
		};
	};
}

/**
 * The projection callback's guard. A user whose subject this transaction
 * locked keeps (and re-takes) the guard taken then. In a transaction that
 * guarded other users, an unguarded user is late and fails closed rather than
 * being locked out of order. A transaction that guarded nobody yet takes the
 * user's guard here.
 */
export async function protectSCIMProjectedUser(
	transaction: AuthTransaction,
	scope: { organizationId: string; userId: string },
): Promise<void> {
	const guarded = guardedUsers.get(transaction);
	if (guarded && !guarded.userIds.has(scope.userId)) {
		throw new SCIMProjectionGuardOrderError(scope.userId);
	}
	await protectAuthorizationMutation(transaction, {
		organizationId: scope.organizationId,
		userIds: [scope.userId],
	});
	recordGuardedUser(transaction, scope.userId);
}
