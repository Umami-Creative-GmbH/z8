/**
 * Organization authorization mutations under the #264 configuration/access
 * protocol (#313).
 *
 * Manual creation reads the actor's membership, employee role/access, direct
 * reports, team permissions and custom roles, plus the target's active/team
 * state, while holding shared organization configuration and user
 * configuration/access protection. A writer of those facts takes the exclusive
 * counterparts in its original transaction before its first dependent write:
 * the organization guard for organization-wide definitions (custom-role grants,
 * team deletion), then the sorted guards of every user whose authority or
 * target facts change. A revocation therefore cannot commit between a
 * submission's protected validation and its commit, and a grant cannot be
 * half-visible to one.
 *
 * Writers acquire nothing earlier-ranked afterwards: protection comes before
 * any employee coordination, identity lock or organization row lock the
 * writer also takes. Routing may discover scope from current rows; it runs
 * again under protection, and a user who was not protected restarts the
 * transaction instead of being locked late.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { employee } from "@/db/schema";
import {
	protectOrganizationConfiguration,
	protectUserConfigurationAccess,
} from "@/lib/time-tracking/work-transaction";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AuthorizationMutationTransaction = Pick<Transaction, "execute" | "select">;

type RoutedAuthorizationScope = {
	/** Employees in the organization whose users' facts change. */
	employeeIds?: readonly string[];
	userIds?: readonly string[];
};

export type AuthorizationMutationScope = RoutedAuthorizationScope & {
	organizationId: string;
	/** Organization-wide definitions that affect every holder, e.g. custom-role grants. */
	organizationWide?: boolean;
	/** Scope that depends on current rows, e.g. an employee's present managers. */
	route?: (transaction: Transaction) => Promise<RoutedAuthorizationScope>;
};

export class AuthorizationScopeChanged extends Error {
	constructor() {
		super("Authorization mutation scope changed while waiting for protection");
		this.name = "AuthorizationScopeChanged";
	}
}

const MAX_ATTEMPTS = 3;

async function resolveUsers(
	transaction: AuthorizationMutationTransaction,
	scope: AuthorizationMutationScope,
): Promise<string[]> {
	const routed = scope.route ? await scope.route(transaction as Transaction) : {};
	const userIds = new Set([...(scope.userIds ?? []), ...(routed.userIds ?? [])]);
	const employeeIds = [...new Set([...(scope.employeeIds ?? []), ...(routed.employeeIds ?? [])])];
	if (employeeIds.length > 0) {
		const rows = await transaction
			.select({ id: employee.id, userId: employee.userId })
			.from(employee)
			.where(
				and(eq(employee.organizationId, scope.organizationId), inArray(employee.id, employeeIds)),
			);
		for (const row of rows) userIds.add(row.userId);
	}
	return [...userIds].sort();
}

/**
 * Takes exclusive protection at the start of the caller's transaction. Throws
 * `AuthorizationScopeChanged` when the scope grew while waiting; callers
 * without their own restart loop should use `withAuthorizationMutation`.
 */
export async function protectAuthorizationMutation(
	transaction: AuthorizationMutationTransaction,
	scope: AuthorizationMutationScope,
): Promise<void> {
	const userIds = await resolveUsers(transaction, scope);
	if (scope.organizationWide) {
		await protectOrganizationConfiguration(transaction, scope.organizationId);
	}
	await protectUserConfigurationAccess(transaction, userIds);
	if (!scope.route && !scope.employeeIds?.length) return;
	const confirmed = await resolveUsers(transaction, scope);
	if (confirmed.some((userId) => !userIds.includes(userId))) {
		throw new AuthorizationScopeChanged();
	}
}

/**
 * Runs `mutation` in one transaction of `database` after protection,
 * restarting in a new transaction on a changed scope.
 */
export async function withAuthorizationMutation<T>(
	scope: AuthorizationMutationScope,
	mutation: (transaction: Transaction) => Promise<T>,
	database: Pick<typeof db, "transaction">,
): Promise<T> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await database.transaction(async (transaction) => {
				await protectAuthorizationMutation(transaction, scope);
				return mutation(transaction);
			});
		} catch (error) {
			if (!(error instanceof AuthorizationScopeChanged) || attempt >= MAX_ATTEMPTS) throw error;
		}
	}
}
