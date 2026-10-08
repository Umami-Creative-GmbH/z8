"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getTravelExpenseFinanceAwaitingCount } from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { SidebarMenuBadge } from "@/components/ui/sidebar";
import { queryKeys } from "@/lib/query/keys";

/**
 * The sidebar Finance item's count (#753): approved expenses in the reader's
 * scope awaiting reimbursement. Loaded after the sidebar renders, so counting
 * never delays navigation; recording money refreshes it (`travel-expenses`
 * `finance` queries). Nothing is shown while loading, on error or at zero.
 */
export function FinanceNavBadge() {
	const { t } = useTranslate();
	const { data: count } = useQuery({
		queryKey: queryKeys.travelExpenses.financeAwaitingCount(),
		queryFn: async () => {
			const result = await getTravelExpenseFinanceAwaitingCount();
			if (!result.success) throw new Error(result.error);
			return result.data.count;
		},
		staleTime: 60_000,
		retry: false,
	});
	if (!count) return null;
	return (
		<SidebarMenuBadge>
			<span aria-hidden="true">{count > 99 ? "99+" : count}</span>
			<span className="sr-only">
				{t(
					"nav.financeAwaiting",
					"{count, plural, one {# expense} other {# expenses}} awaiting reimbursement",
					{ count },
				)}
			</span>
		</SidebarMenuBadge>
	);
}
