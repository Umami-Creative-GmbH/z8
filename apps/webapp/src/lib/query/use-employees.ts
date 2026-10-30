"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaginationState } from "@tanstack/react-table";
import { useState } from "react";
import type {
	EmployeeDirectoryStatus,
	EmployeeListParams,
	PaginatedEmployeeResponse,
} from "@/app/[locale]/(app)/settings/employees/employee-action-types";
import { useOrganization } from "@/hooks/use-organization";
import type { SettingsAccessTier } from "@/lib/settings-access";
import { fetchEmployeeRead } from "./employee-read-client";
import { queryKeys } from "./keys";

interface UseEmployeesOptions {
	initialPageSize?: number;
	organizationId?: string;
	accessTier?: SettingsAccessTier;
}

export function useEmployees(options: UseEmployeesOptions = {}) {
	const { initialPageSize = 20 } = options;
	const queryClient = useQueryClient();
	const organization = useOrganization();

	// Filter state (search, role, status). The directory opens on the current roster (#1438).
	const [search, setSearchState] = useState("");
	const [role, setRoleState] = useState<string>("all");
	const [status, setStatusState] = useState<EmployeeDirectoryStatus>("current");

	// Pagination state (synced with react-table)
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: initialPageSize,
	});

	// Build params from state
	const params: EmployeeListParams = {
		search: search || undefined,
		role: role === "all" ? undefined : (role as EmployeeListParams["role"]),
		status: status === "all" ? undefined : status,
		limit: pagination.pageSize,
		offset: pagination.pageIndex * pagination.pageSize,
	};

	const orgId =
		organization.activeOrganizationId ?? organization.organizationId;
	const userId = organization.userId;
	const hasEmployee =
		Boolean(organization.employeeId) || options.accessTier === "orgAdmin";
	const canLoad =
		hasEmployee &&
		!organization.isLoading &&
		Boolean(userId && orgId) &&
		(!options.organizationId || options.organizationId === orgId);

	// Main employees query
	const employeesQuery = useQuery({
		queryKey: queryKeys.employees.scopedList(userId, orgId, params),
		queryFn: async ({ signal }): Promise<PaginatedEmployeeResponse> => {
			if (!userId || !orgId) throw new Error("Employee context is unavailable");
			return (
				await fetchEmployeeRead(
					"directory",
					{ userId, organizationId: orgId },
					params,
					signal,
				)
			).data;
		},
		enabled: canLoad,
		staleTime: 30 * 1000,
		retry: false,
		placeholderData: (previous, query) =>
			query?.queryKey[1] === orgId && query.queryKey[3] === userId
				? previous
				: undefined,
	});
	const data =
		canLoad && !employeesQuery.isError ? employeesQuery.data : undefined;
	const contextError = organization.error
		? new Error(organization.error)
		: !organization.isLoading && hasEmployee && !canLoad
			? new Error("Employee context changed. Refresh to continue.")
			: null;

	// Filter setters (reset to page 0)
	const setSearch = (value: string) => {
		setSearchState(value);
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	};

	const setRole = (value: string) => {
		setRoleState(value);
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	};

	const setStatus = (value: EmployeeDirectoryStatus) => {
		setStatusState(value);
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	};

	// Refresh
	const refresh = () => {
		if (!canLoad || organization.error) return organization.refetch();
		return queryClient.invalidateQueries({
			queryKey: queryKeys.employees.scopedList(userId, orgId, params),
			exact: true,
		});
	};

	return {
		// Data
		employees: data?.employees ?? [],
		total: data?.total ?? 0,
		hasMore: data?.hasMore ?? false,

		// Loading states
		isLoading: organization.isLoading || (canLoad && employeesQuery.isPending),
		isFetching: employeesQuery.isFetching,
		isError: Boolean(contextError) || employeesQuery.isError,
		error: contextError ?? employeesQuery.error,

		// Auth
		hasEmployee,
		isAdmin: options.accessTier === "orgAdmin",

		// Filters
		search,
		role,
		status,
		setSearch,
		setRole,
		setStatus,

		// Pagination (for react-table)
		pagination,
		setPagination,
		pageCount: Math.ceil((data?.total ?? 0) / pagination.pageSize) || 1,

		// Actions
		refresh,
	};
}
