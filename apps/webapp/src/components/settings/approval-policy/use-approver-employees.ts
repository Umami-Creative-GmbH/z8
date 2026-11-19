"use client";

import { useQuery } from "@tanstack/react-query";
import { getEmployeesByIds } from "@/app/[locale]/(app)/settings/employees/actions";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { queryKeys } from "@/lib/query/keys";

export type ApproverEmployeeResolution =
	| { status: "resolved"; name: string }
	| { status: "unknown" }
	| { status: "pending" };

export type ApproverEmployeeLookup = (
	employeeId: string,
) => ApproverEmployeeResolution;

/**
 * Names the specific-employee approvers of a policy. Uses the organization's
 * employee lookup (scoped to the actor by the action); an ID that no longer
 * resolves in the organization is reported as unknown.
 */
export function useApproverEmployees(
	employeeIds: readonly string[],
): ApproverEmployeeLookup {
	const ids = [...new Set(employeeIds.filter(Boolean))].toSorted();
	const query = useQuery({
		queryKey: queryKeys.employeeSelect.byIds(ids),
		queryFn: async () => {
			const result = await getEmployeesByIds(ids);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data;
		},
		enabled: ids.length > 0,
		staleTime: 5 * 60 * 1000,
		placeholderData: (previous) => previous,
	});
	const names = new Map(
		(query.data ?? []).map((employee) => [
			employee.id,
			buildAuthUserDisplayName(employee.user),
		]),
	);
	const settled = query.isSuccess && !query.isPlaceholderData;

	return (employeeId) => {
		const name = names.get(employeeId);
		if (name !== undefined) return { status: "resolved", name };
		return settled ? { status: "unknown" } : { status: "pending" };
	};
}
