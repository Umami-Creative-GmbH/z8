"use client";

import { useQuery } from "@tanstack/react-query";
import { getPayrollPeriodAction } from "@/app/[locale]/(app)/payroll/actions";
import { queryKeys } from "@/lib/query/keys";
import type { PayrollPeriodRequest } from "./state";

/**
 * The payroll period read (#1891) for the workspace's period and scope: day rows per
 * employee and the absence list. Loaded when a tab first needs it; `refreshedAt` (the
 * summary's generation time) refetches it whenever the workspace summary reloads.
 */
export function usePayrollPeriod(request: PayrollPeriodRequest, refreshedAt: string) {
	return useQuery({
		queryKey: queryKeys.payroll.period({ ...request, refreshedAt }),
		queryFn: async () => {
			const result = await getPayrollPeriodAction(request);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: request.employeeIds?.length !== 0,
		staleTime: Number.POSITIVE_INFINITY,
	});
}
