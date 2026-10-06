import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseReportAdjustment } from "@/db/schema";

/**
 * Link reads of report adjustments (#615). Kept free of evidence imports: the
 * frozen facts loader and per diem pricing (which the facts module reaches)
 * read links, and an import of the revision store from here would be circular.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type AdjustmentExecutor = Database | Transaction;

/** The report an adjustment corrects and why (`travel_expense_report_adjustment`). */
export interface AdjustmentLink {
	originalReportId: string;
	reason: string;
}

/** The original report and reason of an adjustment report; null for any other report. */
export async function loadAdjustmentLink(
	database: AdjustmentExecutor,
	scope: { organizationId: string; reportId: string },
): Promise<AdjustmentLink | null> {
	const [row] = await database
		.select({
			originalReportId: travelExpenseReportAdjustment.originalReportId,
			reason: travelExpenseReportAdjustment.reason,
		})
		.from(travelExpenseReportAdjustment)
		.where(
			and(
				eq(travelExpenseReportAdjustment.organizationId, scope.organizationId),
				eq(travelExpenseReportAdjustment.reportId, scope.reportId),
			),
		)
		.limit(1);
	return row ?? null;
}

/**
 * The other reports of a report's adjustment family (#615): its original and
 * every adjustment of that original. They describe the same expenses, so
 * checks for expenses claimed twice (e.g. per diem days) must not count them
 * against each other; only the approved deltas are ever settled.
 */
export async function loadAdjustmentFamilyIds(
	database: AdjustmentExecutor,
	scope: { organizationId: string; reportId: string },
): Promise<string[]> {
	const link = await loadAdjustmentLink(database, scope);
	const originalReportId = link?.originalReportId ?? scope.reportId;
	const rows = await database
		.select({ reportId: travelExpenseReportAdjustment.reportId })
		.from(travelExpenseReportAdjustment)
		.where(
			and(
				eq(travelExpenseReportAdjustment.organizationId, scope.organizationId),
				eq(travelExpenseReportAdjustment.originalReportId, originalReportId),
			),
		);
	return [originalReportId, ...rows.map((row) => row.reportId)].filter(
		(id) => id !== scope.reportId,
	);
}
