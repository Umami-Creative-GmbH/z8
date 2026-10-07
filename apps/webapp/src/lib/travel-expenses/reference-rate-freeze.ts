import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { travelExpenseReportItem, travelExpenseReportItemConversion } from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { resolveReportConversions } from "./reference-rate-read";

type Transaction = Parameters<Parameters<(typeof appDb)["transaction"]>[0]>[0];

/**
 * Stores the reference conversions a submission freezes (#608). Called by the
 * submission owner under the report lock, before it reads the rows it
 * freezes: earlier cycles' reference rows are replaced by the conversions
 * resolved now, so the frozen facts and later comparisons read exactly the
 * publication version that was applied, whatever ECB corrects afterwards.
 */
export async function storeSubmittedReferenceConversions(
	tx: Transaction,
	scope: {
		organizationId: string;
		reportId: string;
		reimbursementCurrency: string;
		userId: string;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<void> {
	const owned = and(
		eq(travelExpenseReportItemConversion.reportId, scope.reportId),
		eq(travelExpenseReportItemConversion.organizationId, scope.organizationId),
	);
	await tx
		.delete(travelExpenseReportItemConversion)
		.where(and(owned, eq(travelExpenseReportItemConversion.basis, "reference_rate")));

	const items = await tx
		.select({
			id: travelExpenseReportItem.id,
			expenseDate: travelExpenseReportItem.expenseDate,
			originalCurrency: travelExpenseReportItem.originalCurrency,
		})
		.from(travelExpenseReportItem)
		.where(
			and(
				eq(travelExpenseReportItem.reportId, scope.reportId),
				eq(travelExpenseReportItem.organizationId, scope.organizationId),
			),
		);
	const { conversions } = await resolveReportConversions(
		tx,
		{
			organizationId: scope.organizationId,
			reports: [
				{
					id: scope.reportId,
					status: "draft",
					reimbursementCurrency: scope.reimbursementCurrency,
					items,
				},
			],
		},
		now,
	);
	const at = dateFromInstant(now);
	for (const [itemId, conversion] of conversions) {
		if (conversion.basis !== "reference_rate") continue;
		const values = {
			basis: conversion.basis,
			sourceCurrency: conversion.sourceCurrency,
			targetCurrency: conversion.targetCurrency,
			chargedAmount: null,
			evidenceReceiptId: null,
			rate: conversion.rate.value,
			rateBaseCurrency: conversion.rate.base,
			rateQuoteCurrency: conversion.rate.quote,
			rateDate: conversion.rateDate,
			reason: null,
			rateEvidence: null,
			authorizedByEmployeeId: null,
			authorizedByName: null,
			authorizedAt: null,
			referenceExpenseDate: conversion.expenseDate,
			referenceSource: conversion.source,
			recordedBy: scope.userId,
			updatedAt: at,
		};
		// A row recorded for the item's former currency pair never applied; it is replaced.
		await tx
			.insert(travelExpenseReportItemConversion)
			.values({ organizationId: scope.organizationId, reportId: scope.reportId, itemId, ...values })
			.onConflictDoUpdate({ target: travelExpenseReportItemConversion.itemId, set: values });
	}
}
