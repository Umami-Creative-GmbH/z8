"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { getAllowanceExceptionItems } from "@/app/[locale]/(app)/settings/travel-expenses/allowance-override-actions";
import { getForeignDraftExpenses } from "@/app/[locale]/(app)/settings/travel-expenses/conversion-actions";
import { queryKeys } from "@/lib/query/keys";
import type { AllowanceExceptionItem } from "@/lib/travel-expenses/allowance-override-store";
import type { ForeignDraftItem } from "@/lib/travel-expenses/conversion-store";

/** Foreign-currency items of draft reports; shared by their card and the Exceptions tab badge. */
export const foreignDraftExpensesQuery = queryOptions({
	queryKey: queryKeys.travelExpenses.foreignDraftExpenses(),
	queryFn: async () => {
		const result = await getForeignDraftExpenses();
		if (!result.success) throw new Error(result.error);
		return result.data;
	},
});

/** Allowances needing a manual calculation; shared by their card and the Exceptions tab badge. */
export const allowanceExceptionsQuery = queryOptions({
	queryKey: queryKeys.travelExpenses.allowanceExceptions(),
	queryFn: async () => {
		const result = await getAllowanceExceptionItems();
		if (!result.success) throw new Error(result.error);
		return result.data;
	},
});

/**
 * Admin work waiting on the Exceptions tab (#689): foreign-currency items
 * without a conversion and allowances without a manual amount. Project
 * attribution exceptions are authorizations already made, not a queue.
 */
export function pendingExceptionCount(
	foreignDrafts: readonly Pick<ForeignDraftItem, "conversion">[],
	allowanceExceptions: readonly Pick<AllowanceExceptionItem, "override">[],
): number {
	return (
		foreignDrafts.filter((item) => !item.conversion).length +
		allowanceExceptions.filter((item) => !item.override).length
	);
}

/** The pending count from the cards' own cached queries, so it follows every change they make. */
export function usePendingExceptionCount(): number {
	const { data: foreignDrafts = [] } = useQuery(foreignDraftExpensesQuery);
	const { data: allowanceExceptions = [] } = useQuery(allowanceExceptionsQuery);
	return pendingExceptionCount(foreignDrafts, allowanceExceptions);
}
