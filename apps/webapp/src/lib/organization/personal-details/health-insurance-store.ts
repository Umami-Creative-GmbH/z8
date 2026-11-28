import { and, desc, eq, gt, sql } from "drizzle-orm";
import { employee } from "@/db/schema";
import { employeeHealthInsurance } from "@/db/schema/personal-details";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";
import type { HealthInsuranceValue } from "./health-insurance";

/**
 * The health insurance history table, reached only through the personal details
 * module. Every query is scoped by organization and employee.
 */

type Reader = Pick<DatabaseClient, "select">;
type Writer = Pick<DatabaseClient, "insert">;
type Deleter = Pick<DatabaseClient, "delete">;

type Scope = { organizationId: string; employeeId: string };

export type StoredHealthInsuranceEntry = {
	validFrom: string;
	value: HealthInsuranceValue | null;
};

/**
 * Whether the employee holds a health insurance in the organization: not as an
 * External Contractor (engagement kind contractor, the kind in force today on the
 * employee record, #1995). Their history is kept, only not read or written.
 * For reading; a write checks with `holdsHealthInsuranceForWrite`.
 */
export async function holdsHealthInsurance(db: Reader, scope: Scope): Promise<boolean> {
	const [row] = await engagementKindOf(db, scope);
	return isHeldBy(row);
}

/**
 * `holdsHealthInsurance` for a write, inside its transaction: it keeps the
 * employee row share-locked until the transaction ends, so a conversion to
 * External Contractor waits for the write to commit (or the write sees the
 * conversion and is refused). Every health insurance write checks with this
 * (change, end, applying a change request).
 */
export async function holdsHealthInsuranceForWrite(tx: Reader, scope: Scope): Promise<boolean> {
	const [row] = await engagementKindOf(tx, scope).for("share");
	return isHeldBy(row);
}

function engagementKindOf(db: Reader, scope: Scope) {
	return db
		.select({ engagementKind: employee.engagementKind })
		.from(employee)
		.where(
			and(eq(employee.id, scope.employeeId), eq(employee.organizationId, scope.organizationId)),
		)
		.limit(1);
}

function isHeldBy(row: { engagementKind: EngagementKind } | undefined): boolean {
	return row !== undefined && row.engagementKind !== ("contractor" satisfies EngagementKind);
}

/** The employee's health insurance history in the organization, latest valid-from first. */
export async function loadHealthInsuranceHistory(
	db: Reader,
	scope: Scope,
): Promise<StoredHealthInsuranceEntry[]> {
	const rows = await db
		.select({
			validFrom: employeeHealthInsurance.validFrom,
			kind: employeeHealthInsurance.kind,
			insurerName: employeeHealthInsurance.insurerName,
			betriebsnummer: employeeHealthInsurance.insurerBetriebsnummer,
		})
		.from(employeeHealthInsurance)
		.where(
			and(
				eq(employeeHealthInsurance.organizationId, scope.organizationId),
				eq(employeeHealthInsurance.employeeId, scope.employeeId),
			),
		)
		.orderBy(desc(employeeHealthInsurance.validFrom));
	return rows.map((row) => ({
		validFrom: row.validFrom,
		value:
			row.kind !== null && row.insurerName !== null
				? { kind: row.kind, insurerName: row.insurerName, betriebsnummer: row.betriebsnummer }
				: null,
	}));
}

/**
 * Records `value` (null ends the health insurance) from `validFrom`. A row with
 * the same valid-from is replaced: `replaced` tells the caller it was a correction.
 */
export async function writeHealthInsuranceEntry(
	db: Writer,
	entry: Scope & {
		validFrom: string;
		value: HealthInsuranceValue | null;
		actorUserId: string;
	},
): Promise<{ replaced: boolean }> {
	const value = {
		kind: entry.value?.kind ?? null,
		insurerName: entry.value?.insurerName ?? null,
		insurerBetriebsnummer: entry.value?.betriebsnummer ?? null,
	};
	const [row] = await db
		.insert(employeeHealthInsurance)
		.values({
			organizationId: entry.organizationId,
			employeeId: entry.employeeId,
			validFrom: entry.validFrom,
			...value,
			createdBy: entry.actorUserId,
			updatedBy: entry.actorUserId,
		})
		.onConflictDoUpdate({
			target: [
				employeeHealthInsurance.organizationId,
				employeeHealthInsurance.employeeId,
				employeeHealthInsurance.validFrom,
			],
			set: { ...value, updatedBy: entry.actorUserId, updatedAt: sql`now()` },
		})
		// PostgreSQL sets xmax on the row an upsert updated, not on one it inserted.
		.returning({ inserted: sql<boolean>`(xmax = 0)` });
	return { replaced: row?.inserted === false };
}

/**
 * Removes the entries with a valid-from after `after`: an end supersedes them,
 * so no value comes into force after it. Returns how many were removed.
 */
export async function removeHealthInsuranceEntriesAfter(
	db: Deleter,
	scope: Scope & { after: string },
): Promise<number> {
	const removed = await db
		.delete(employeeHealthInsurance)
		.where(
			and(
				eq(employeeHealthInsurance.organizationId, scope.organizationId),
				eq(employeeHealthInsurance.employeeId, scope.employeeId),
				gt(employeeHealthInsurance.validFrom, scope.after),
			),
		)
		.returning({ validFrom: employeeHealthInsurance.validFrom });
	return removed.length;
}
