"use client";

import { useQuery } from "@tanstack/react-query";
import {
	type EmployeeClockActivity,
	type EmployeeClockPresenceMap,
	type EmployeeClockStatusMap,
	getEmployeeClockStatuses,
} from "@/app/[locale]/(app)/settings/employees/employee-clock-status.actions";
import type { EmployeeClockStatus } from "@/components/user-avatar";
import { queryKeys } from "./keys";

interface UseEmployeeClockStatusesOptions {
	organizationId?: string | null;
	polling?: boolean;
	pollingIntervalMs?: number;
	enabled?: boolean;
}

const EMPTY_SNAPSHOTS: EmployeeClockPresenceMap = {};

function normalizeEmployeeIds(employeeIds: string[]) {
	return Array.from(
		new Set(
			employeeIds.flatMap((id) => {
				const trimmed = id.trim();
				return trimmed ? [trimmed] : [];
			}),
		),
	).toSorted();
}

export function useEmployeeClockStatuses(
	employeeIds: string[],
	options: UseEmployeeClockStatusesOptions = {},
) {
	const {
		organizationId,
		polling = false,
		pollingIntervalMs,
		enabled = true,
	} = options;
	const normalizedEmployeeIds = normalizeEmployeeIds(employeeIds);
	const query = useQuery({
		queryKey: queryKeys.employeeClockStatuses.list(
			organizationId ?? "active",
			normalizedEmployeeIds,
		),
		queryFn: async (): Promise<EmployeeClockPresenceMap> => {
			const result = await getEmployeeClockStatuses(normalizedEmployeeIds);
			if (!result.success) {
				throw new Error(result.error);
			}

			return result.data;
		},
		enabled: enabled && normalizedEmployeeIds.length > 0,
		staleTime: 30 * 1000,
		refetchOnWindowFocus: true,
		placeholderData: (previousData) => previousData,
		refetchInterval: polling ? (pollingIntervalMs ?? 30 * 1000) : false,
	});
	const snapshots = query.data ?? EMPTY_SNAPSHOTS;
	const statuses = Object.fromEntries(
		Object.entries(snapshots).map(([employeeId, snapshot]) => [
			employeeId,
			snapshot.status,
		]),
	) as EmployeeClockStatusMap;
	const getStatus = (employeeId: string): EmployeeClockStatus => {
		return statuses[employeeId.trim()] ?? "unknown";
	};
	const getActivity = (employeeId: string): EmployeeClockActivity | null => {
		const snapshot = snapshots[employeeId.trim()];
		if (
			!snapshot ||
			snapshot.lastActivityAt === null ||
			snapshot.lastActivityUtcOffsetMinutes === null
		) {
			return null;
		}

		return {
			lastActivityAt: snapshot.lastActivityAt,
			lastActivityUtcOffsetMinutes: snapshot.lastActivityUtcOffsetMinutes,
		};
	};

	return {
		...query,
		employeeIds: normalizedEmployeeIds,
		snapshots,
		statuses,
		getStatus,
		getActivity,
	};
}
