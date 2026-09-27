import { and, eq, sql } from "drizzle-orm";
import { employee } from "@/db/schema";
import { AuthorizationScopeChanged } from "@/lib/authorization/authorization-mutation";
import {
	employeeCoordinationGuard,
	holdGuard,
	userConfigurationAccessGuard,
} from "@/lib/time-tracking/work-transaction/ranks";
import type { LifecycleClient } from "./types";

/**
 * Lock order for lifecycle transitions follows the acquisition protocol (#264,
 * #477): exclusive configuration/access protection of the employee's user
 * (#313: transitions change access and active state, which manual creation
 * reads under the shared counterpart), then the employee key (the canonical
 * clocking key), then the organization row, then scoped rows. A departure runs
 * as a work transaction (`departure-transaction.ts`) whose coordinator takes
 * these after the shared adoption gate. The other lifecycle commands keep their
 * own transactions and take the same guards here, recorded in the transaction's
 * ledger. Member/owner mutations and the owner-invariant triggers take the same
 * organization row lock, so owner checks still serialize with them.
 */
export async function lockLifecycleScope(
	tx: LifecycleClient,
	organizationId: string,
	employeeId: string,
): Promise<void> {
	const userIds = await lifecycleUserIds(tx, organizationId, employeeId);
	for (const userId of userIds) {
		await holdGuard(tx, userConfigurationAccessGuard(userId, "exclusive"));
	}
	const confirmed = await lifecycleUserIds(tx, organizationId, employeeId);
	if (confirmed.some((userId) => !userIds.includes(userId))) {
		throw new AuthorizationScopeChanged();
	}
	await holdGuard(tx, employeeCoordinationGuard(employeeId));
	await lockLifecycleOrganization(tx, organizationId);
}

/** The user whose configuration and access a transition of the employee changes. */
export async function lifecycleUserIds(
	tx: Pick<LifecycleClient, "select">,
	organizationId: string,
	employeeId: string,
): Promise<string[]> {
	const rows = await tx
		.select({ userId: employee.userId })
		.from(employee)
		.where(and(eq(employee.organizationId, organizationId), eq(employee.id, employeeId)));
	return rows.map(({ userId }) => userId);
}

export async function lockLifecycleOrganization(
	tx: Pick<LifecycleClient, "execute">,
	organizationId: string,
): Promise<void> {
	const result = await tx.execute(sql`
		SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE
	`);
	if (result.rows.length !== 1) throw new Error("organization_not_found");
}

/**
 * The executor reads after taking locks and relies on each statement seeing
 * rows committed by transactions it waited for.
 */
export async function assertReadCommitted(tx: Pick<LifecycleClient, "execute">): Promise<void> {
	const result = await tx.execute<{ level: string }>(
		sql`SELECT current_setting('transaction_isolation') AS level`,
	);
	if (result.rows[0]?.level !== "read committed") {
		throw new Error("lifecycle_transition_requires_read_committed");
	}
}
