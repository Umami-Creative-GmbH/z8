import { sql } from "drizzle-orm";
import type { LifecycleTransaction } from "./types";

/**
 * Lock order for lifecycle transitions: organization row, then employee
 * advisory locks (sorted by ID when several are needed), then scoped rows.
 * Existing member/owner mutations and the owner-invariant triggers take the
 * same organization row lock, so owner checks serialize with them.
 */
export async function lockLifecycleOrganization(
	tx: LifecycleTransaction,
	organizationId: string,
): Promise<void> {
	const result = await tx.execute(sql`
		SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE
	`);
	if (result.rows.length !== 1) throw new Error("organization_not_found");
}

/** Same key as canonical clocking, so departures serialize with clock actions. */
export async function lockLifecycleEmployee(
	tx: LifecycleTransaction,
	employeeId: string,
): Promise<void> {
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${employeeId}, 0))`,
	);
}

/**
 * The executor reads after taking locks and relies on each statement seeing
 * rows committed by transactions it waited for.
 */
export async function assertReadCommitted(
	tx: LifecycleTransaction,
): Promise<void> {
	const result = await tx.execute<{ level: string }>(
		sql`SELECT current_setting('transaction_isolation') AS level`,
	);
	if (result.rows[0]?.level !== "read committed") {
		throw new Error("lifecycle_transition_requires_read_committed");
	}
}
