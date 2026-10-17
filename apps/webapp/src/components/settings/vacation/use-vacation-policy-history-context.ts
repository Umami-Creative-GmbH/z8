"use client";

import { useQuery } from "@tanstack/react-query";
import { getVacationPolicyHistoryContext } from "@/app/[locale]/(app)/settings/vacation/assignment-actions";

export function useVacationPolicyHistoryContext(
	organizationId: string,
	enabled = true,
) {
	return useQuery({
		queryKey: ["vacation-policy-history-context", organizationId],
		queryFn: async () => {
			const result = await getVacationPolicyHistoryContext(organizationId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled,
	});
}
