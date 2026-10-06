"use client";

import { useQuery } from "@tanstack/react-query";
import { getMyTravelExpenseSettlements } from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { queryKeys } from "@/lib/query/keys";
import { BalanceText } from "./settlement-status";

/**
 * The reimbursement balance of one of the employee's approved expenses in a
 * list (#612). All rows share one query of the employee's own balances.
 */
export function OwnSettlementTag({
	source,
}: {
	source: { type: "report" | "legacy_claim"; id: string };
}) {
	const { data } = useQuery({
		queryKey: queryKeys.travelExpenses.mySettlements(),
		queryFn: async () => {
			const result = await getMyTravelExpenseSettlements();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const settlement = data?.[`${source.type}:${source.id}`];
	if (!settlement) return null;
	return (
		<span className="text-sm text-muted-foreground">
			{settlement.summary.currencies.map((line) => (
				<span key={line.currency} className="block tabular-nums">
					<BalanceText line={line} />
				</span>
			))}
		</span>
	);
}
