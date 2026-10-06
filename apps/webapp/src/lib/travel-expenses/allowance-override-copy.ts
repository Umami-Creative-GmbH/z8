import { and, eq, isNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseAllowanceOverride } from "@/db/schema";

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Copies the active allowance overrides (#610) of a report onto the items of
 * its adjustment copy (#615), like authorized manual rates: the same
 * authorization by value, for the same facts. The copy applies only while the
 * adjustment's item keeps those facts; an administrator can revoke or replace
 * it there like any other override.
 */
export async function copyAllowanceOverrides(
	tx: Transaction,
	input: {
		organizationId: string;
		sourceReportId: string;
		targetReportId: string;
		/** Source item ID → copied item ID. */
		itemIds: ReadonlyMap<string, string>;
	},
): Promise<void> {
	const rows = await tx
		.select()
		.from(travelExpenseAllowanceOverride)
		.where(
			and(
				eq(travelExpenseAllowanceOverride.reportId, input.sourceReportId),
				eq(travelExpenseAllowanceOverride.organizationId, input.organizationId),
				isNull(travelExpenseAllowanceOverride.revokedAt),
			),
		);
	for (const row of rows) {
		const itemId = input.itemIds.get(row.itemId);
		if (!itemId) continue;
		const { id: _id, reportId: _reportId, itemId: _itemId, ...authorization } = row;
		await tx
			.insert(travelExpenseAllowanceOverride)
			.values({ ...authorization, reportId: input.targetReportId, itemId });
	}
}
