"use client";

import { useQuery } from "@tanstack/react-query";
import { getPresenceStatus } from "@/app/[locale]/(app)/time-tracking/actions";
import { queryKeys } from "@/lib/query/keys";

export function usePresenceStatus(employeeId: string | undefined) {
	return useQuery({
		queryKey: queryKeys.workPolicies.presence.status(employeeId ?? ""),
		queryFn: async () => {
			if (!employeeId) return null;
			const result = await getPresenceStatus(employeeId);
			if (result.success) return result.data;
			return null;
		},
		enabled: !!employeeId,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});
}
