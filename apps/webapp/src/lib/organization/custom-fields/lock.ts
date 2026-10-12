/**
 * The one per-organization custom field lock (spec #769). Definition changes
 * (#817) and payroll identifier choices (#821) take it exclusively; value
 * writes (#818/#819) take it shared, so they run side by side but never next
 * to a definition change: a write that waited sees the field or option as the
 * change left it.
 */
import "server-only";

import { sql } from "drizzle-orm";
import type { db } from "@/db";

type Transaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
type Locker = Pick<Transaction, "execute">;

const lockKey = (organizationId: string) =>
	sql`hashtextextended(${`custom_fields:${organizationId}`}, 0)`;

/** Waits until no value write or other definition change of the organization runs; held until commit. */
export async function lockCustomFieldDefinitions(
	tx: Locker,
	organizationId: string,
): Promise<void> {
	await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(organizationId)})`);
}

/** Waits until no definition change of the organization runs; held until commit. */
export async function lockCustomFieldValueWrites(
	tx: Locker,
	organizationId: string,
): Promise<void> {
	await tx.execute(sql`select pg_advisory_xact_lock_shared(${lockKey(organizationId)})`);
}
