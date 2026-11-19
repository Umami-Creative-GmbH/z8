import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseLegacyDraftConversion } from "@/db/schema";
import type { LegacyConversionFlag, LegacyDraftSnapshot } from "./legacy-draft-conversion";

/**
 * Reads of legacy draft conversions (#616). Dependency-light on purpose: the
 * legacy receipt finalization (also loaded by the cleanup worker) asks whether
 * a claim was converted.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

type ConversionRow = typeof travelExpenseLegacyDraftConversion.$inferSelect;

/** The report a legacy claim was continued as, if any. */
export async function findLegacyDraftConversion(
	database: Reader,
	input: { organizationId: string; claimId: string },
): Promise<{ reportId: string } | null> {
	const [row] = await database
		.select({ reportId: travelExpenseLegacyDraftConversion.reportId })
		.from(travelExpenseLegacyDraftConversion)
		.where(
			and(
				eq(travelExpenseLegacyDraftConversion.organizationId, input.organizationId),
				eq(travelExpenseLegacyDraftConversion.claimId, input.claimId),
			),
		)
		.limit(1);
	return row ?? null;
}

/** Whether a legacy claim was continued as a report; it then takes no further uploads. */
export async function isLegacyDraftConverted(
	database: Reader,
	input: { organizationId: string; claimId: string },
): Promise<boolean> {
	return (await findLegacyDraftConversion(database, input)) !== null;
}

export interface LegacyConversionView {
	claimId: string;
	reportId: string;
	itemId: string;
	convertedAt: string;
	flags: LegacyConversionFlag[];
	legacy: LegacyDraftSnapshot;
}

function toView(row: ConversionRow): LegacyConversionView {
	return {
		claimId: row.claimId,
		reportId: row.reportId,
		itemId: row.itemId,
		convertedAt: row.convertedAt.toISOString(),
		flags: row.flags,
		legacy: row.legacyFacts,
	};
}

interface ConversionOwner {
	organizationId: string;
	employeeId: string;
}

/** The owner's conversion that created `reportId`, or that continued `claimId`. */
export async function loadOwnLegacyConversion(
	database: Reader,
	owner: ConversionOwner,
	ref: { reportId: string } | { claimId: string },
): Promise<LegacyConversionView | null> {
	const [row] = await database
		.select()
		.from(travelExpenseLegacyDraftConversion)
		.where(
			and(
				eq(travelExpenseLegacyDraftConversion.organizationId, owner.organizationId),
				eq(travelExpenseLegacyDraftConversion.employeeId, owner.employeeId),
				"reportId" in ref
					? eq(travelExpenseLegacyDraftConversion.reportId, ref.reportId)
					: eq(travelExpenseLegacyDraftConversion.claimId, ref.claimId),
			),
		)
		.limit(1);
	return row ? toView(row) : null;
}

/** Report ids of the owner's converted legacy drafts among `claimIds`, by claim id. */
export async function listOwnLegacyConversions(
	database: Reader,
	owner: ConversionOwner,
	claimIds: string[],
): Promise<Map<string, string>> {
	if (claimIds.length === 0) return new Map();
	const rows = await database
		.select({
			claimId: travelExpenseLegacyDraftConversion.claimId,
			reportId: travelExpenseLegacyDraftConversion.reportId,
		})
		.from(travelExpenseLegacyDraftConversion)
		.where(
			and(
				eq(travelExpenseLegacyDraftConversion.organizationId, owner.organizationId),
				eq(travelExpenseLegacyDraftConversion.employeeId, owner.employeeId),
				inArray(travelExpenseLegacyDraftConversion.claimId, claimIds),
			),
		);
	return new Map(rows.map((row) => [row.claimId, row.reportId]));
}
