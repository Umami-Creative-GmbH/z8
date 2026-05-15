"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	getEmployeeClockStatuses,
	type EmployeeClockStatusMap,
} from "@/app/[locale]/(app)/settings/employees/employee-clock-status.actions";
import type { EmployeeClockStatus } from "@/components/user-avatar";
import { queryKeys } from "./keys";

interface UseEmployeeClockStatusesOptions {
	organizationId?: string | null;
	polling?: boolean;
	pollingIntervalMs?: number;
	enabled?: boolean;
}

const EMPTY_STATUSES: EmployeeClockStatusMap = {};

function normalizeEmployeeIds(employeeIds: string[]) {
	return [...new Set(employeeIds.map((id) => id.trim()).filter(Boolean))].sort();
}

export function useEmployeeClockStatuses(
	employeeIds: string[],
	options: UseEmployeeClockStatusesOptions = {},
) {
	const { organizationId, polling = false, pollingIntervalMs, enabled = true } = options;
	const normalizedEmployeeIds = useMemo(() => normalizeEmployeeIds(employeeIds), [employeeIds]);
	const query = useQuery({
		queryKey: queryKeys.employeeClockStatuses.list(
			organizationId ?? "active",
			normalizedEmployeeIds,
		),
		queryFn: async (): Promise<EmployeeClockStatusMap> => {
			const result = await getEmployeeClockStatuses(normalizedEmployeeIds);
			return result.success ? result.data : EMPTY_STATUSES;
		},
		enabled: enabled && normalizedEmployeeIds.length > 0,
		staleTime: 30 * 1000,
		refetchOnWindowFocus: true,
		placeholderData: (previousData) => previousData,
		refetchInterval: polling ? (pollingIntervalMs ?? 30 * 1000) : false,
	});
	const statuses = query.data ?? EMPTY_STATUSES;
	const getStatus = useMemo(
		() =>
			(employeeId: string): EmployeeClockStatus => {
				return statuses[employeeId.trim()] ?? "unknown";
			},
		[statuses],
	);

	return {
		...query,
		employeeIds: normalizedEmployeeIds,
		statuses,
		getStatus,
	};
}
