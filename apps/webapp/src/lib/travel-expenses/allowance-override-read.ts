import { and, eq, inArray, isNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseAllowanceOverride } from "@/db/schema";
import { instantFromDate, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import type { AllowanceOverride } from "./allowance-override";

/**
 * Reads of the active allowance overrides (#610). Every read is scoped by
 * organization; the frozen-facts loader reads by report alone (like items)
 * so the builder can refuse a row of another organization.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

export type AllowanceOverrideRow = typeof travelExpenseAllowanceOverride.$inferSelect;

export function allowanceOverrideFromRow(row: AllowanceOverrideRow): AllowanceOverride {
	return {
		id: row.id,
		kind: row.kind,
		amount: row.amount,
		currency: row.currency,
		reason: row.reason,
		evidence: row.evidence,
		calculationBasis: row.calculationBasis,
		scope: row.scope,
		situation: row.situation,
		authorizedBy: { employeeId: row.authorizedByEmployeeId, name: row.authorizedByName },
		authorizedAt: instantToCanonicalString(instantFromDate(row.authorizedAt)),
	};
}

/** The active override of each given item of the organization, by item ID. */
export async function loadActiveAllowanceOverrides(
	database: Reader,
	input: { organizationId: string; itemIds: readonly string[] },
): Promise<Map<string, AllowanceOverride>> {
	const overrides = new Map<string, AllowanceOverride>();
	if (input.itemIds.length === 0) return overrides;
	const rows = await database
		.select()
		.from(travelExpenseAllowanceOverride)
		.where(
			and(
				eq(travelExpenseAllowanceOverride.organizationId, input.organizationId),
				inArray(travelExpenseAllowanceOverride.itemId, [...input.itemIds]),
				isNull(travelExpenseAllowanceOverride.revokedAt),
			),
		);
	for (const row of rows) overrides.set(row.itemId, allowanceOverrideFromRow(row));
	return overrides;
}

/** Active override rows of one report, for the frozen facts (read by report alone). */
export function loadReportAllowanceOverrideRows(
	database: Reader,
	reportId: string,
): Promise<AllowanceOverrideRow[]> {
	return database
		.select()
		.from(travelExpenseAllowanceOverride)
		.where(
			and(
				eq(travelExpenseAllowanceOverride.reportId, reportId),
				isNull(travelExpenseAllowanceOverride.revokedAt),
			),
		);
}
