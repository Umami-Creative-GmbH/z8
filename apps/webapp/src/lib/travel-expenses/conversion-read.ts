import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseReportItemConversion, travelExpenseSettings } from "@/db/schema";
import { conversionFromRow } from "./conversion-row";
import { type ItemConversion, isReimbursementCurrencySupported } from "./currency-conversion";
import { DEFAULT_REIMBURSEMENT_CURRENCY } from "./receipt-report";

/** Reads of #607 conversions and the organization's reimbursement currency. */

type Database = typeof appDb;
type Reader = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The reimbursement currency new reports of the organization use. */
export async function loadOrganizationReimbursementCurrency(
	database: Reader,
	organizationId: string,
): Promise<string> {
	const [settings] = await database
		.select({ currency: travelExpenseSettings.reimbursementCurrency })
		.from(travelExpenseSettings)
		.where(eq(travelExpenseSettings.organizationId, organizationId))
		.limit(1);
	const currency = settings?.currency ?? DEFAULT_REIMBURSEMENT_CURRENCY;
	return isReimbursementCurrencySupported(currency) ? currency : DEFAULT_REIMBURSEMENT_CURRENCY;
}

/** Saved conversions of the reports' items, by item id. */
export async function loadReportConversions(
	database: Reader,
	scope: { organizationId: string; reportIds: readonly string[] },
): Promise<Map<string, ItemConversion>> {
	if (scope.reportIds.length === 0) return new Map();
	const rows = await database
		.select()
		.from(travelExpenseReportItemConversion)
		.where(
			and(
				eq(travelExpenseReportItemConversion.organizationId, scope.organizationId),
				inArray(travelExpenseReportItemConversion.reportId, [...scope.reportIds]),
			),
		);
	return new Map(
		rows.flatMap((row) => {
			const conversion = conversionFromRow(row);
			return conversion ? [[row.itemId, conversion] as const] : [];
		}),
	);
}

/**
 * Every conversion row linked to the report, read by report alone so that a
 * row of another organization is refused by the facts builder instead of
 * silently left out.
 */
export async function loadReportConversionRows(
	database: Reader,
	reportId: string,
): Promise<
	{ organizationId: string; reportId: string; itemId: string; conversion: ItemConversion }[]
> {
	const rows = await database
		.select()
		.from(travelExpenseReportItemConversion)
		.where(eq(travelExpenseReportItemConversion.reportId, reportId));
	return rows.flatMap((row) => {
		const conversion = conversionFromRow(row);
		return conversion
			? [
					{
						organizationId: row.organizationId,
						reportId: row.reportId,
						itemId: row.itemId,
						conversion,
					},
				]
			: [];
	});
}
