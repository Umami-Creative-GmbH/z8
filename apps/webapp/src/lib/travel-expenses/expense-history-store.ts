import { and, desc, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseClaim } from "@/db/schema";
import { loadAdjustmentOriginals } from "./adjustment-read";
import { buildExpenseHistory, type ExpenseHistoryRow } from "./expense-history";
import { listOwnLegacyConversions } from "./legacy-draft-conversion-read";
import { listOwnReportSummaries } from "./report-store";
import type { SettlementSummary } from "./settlement";
import { listOwnSettlementAccounts } from "./settlement-store";

/**
 * Loads the employee's unified expense history (#617): every report of theirs
 * in any status, their legacy claims (under their original authority) and the
 * balances of approved ones. Everything is scoped to the owner in the active
 * organization; nobody else's expenses are ever read here.
 */

type Database = typeof appDb;

export async function listOwnExpenseHistory(
	database: Database,
	owner: { organizationId: string; employeeId: string; userId: string },
): Promise<ExpenseHistoryRow[]> {
	const [reports, claims, accounts] = await Promise.all([
		listOwnReportSummaries(database, owner),
		database
			.select({
				id: travelExpenseClaim.id,
				type: travelExpenseClaim.type,
				status: travelExpenseClaim.status,
				calculatedAmount: travelExpenseClaim.calculatedAmount,
				calculatedCurrency: travelExpenseClaim.calculatedCurrency,
				tripStartDate: travelExpenseClaim.tripStartDate,
				tripEndDate: travelExpenseClaim.tripEndDate,
				destinationCity: travelExpenseClaim.destinationCity,
				updatedAt: travelExpenseClaim.updatedAt,
			})
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.organizationId, owner.organizationId),
					eq(travelExpenseClaim.employeeId, owner.employeeId),
				),
			)
			.orderBy(desc(travelExpenseClaim.updatedAt)),
		listOwnSettlementAccounts(database, owner),
	]);
	const [adjustmentOriginals, conversions] = await Promise.all([
		loadAdjustmentOriginals(database, {
			organizationId: owner.organizationId,
			reportIds: reports.map((report) => report.id),
		}),
		listOwnLegacyConversions(
			database,
			owner,
			claims.filter((claim) => claim.status === "draft").map((claim) => claim.id),
		),
	]);
	const balances = new Map<string, SettlementSummary>(
		accounts
			.filter((account) => account.approved)
			.map((account) => [`${account.source.type}:${account.source.id}`, account.summary]),
	);
	return buildExpenseHistory({
		reports,
		adjustmentOriginals,
		claims: claims.map((claim) => ({ ...claim, updatedAt: claim.updatedAt.toISOString() })),
		conversions,
		balances,
	});
}
