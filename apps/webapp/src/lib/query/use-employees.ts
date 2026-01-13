"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaginationState } from "@tanstack/react-table";
import { useCallback, useState } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import {
	type EmployeeListParams,
	type PaginatedEmployeeResponse,
	listEmployees,
} from "@/app/[locale]/(app)/settings/employees/actions";
import { queryKeys } from "./keys";

interface UseEmployeesOptions {
	initialPageSize?: number;
}

export function useEmployees(options: UseEmployeesOptions = {}) {
	const { initialPageSize = 20 } = options;
	const queryClient = useQueryClient();

	// Filter state (search, role, status)
	const [search, setSearchState] = useState("");
	const [role, setRoleState] = useState<string>("all");
	const [status, setStatusState] = useState<string>("all");

	// Pagination state (synced with react-table)
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: initialPageSize,
	});

	// Build params from state
	const params: EmployeeListParams = {
		search: search || undefined,
		role: role === "all" ? undefined : (role as EmployeeListParams["role"]),
		status: status === "all" ? undefined : (status as EmployeeListParams["status"]),
		limit: pagination.pageSize,
		offset: pagination.pageIndex * pagination.pageSize,
	};

	// Current employee query
	const currentEmployeeQuery = useQuery({
		queryKey: ["current-employee"],
		queryFn: getCurrentEmployee,
		staleTime: 5 * 60 * 1000,
	});

	const orgId = currentEmployeeQuery.data?.organizationId ?? "";
	const isAdmin = currentEmployeeQuery.data?.role === "admin";
	const hasEmployee = !!currentEmployeeQuery.data;

	// Main employees query
	const employeesQuery = useQuery({
		queryKey: queryKeys.employees.list(orgId, params),
		queryFn: async (): Promise<PaginatedEmployeeResponse> => {
			const result = await listEmployees(params);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: hasEmployee && !!orgId,
		staleTime: 30 * 1000,
		placeholderData: (prev) => prev,
	});

	// Filter setters (reset to page 0)
	const setSearch = useCallback((value: string) => {
		setSearchState(value);
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, []);

	const setRole = useCallback((value: string) => {
		setRoleState(value);
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, []);

	const setStatus = useCallback((value: string) => {
		setStatusState(value);
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, []);

	// Refresh
	const refresh = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.employees.all });
	}, [queryClient]);

	return {
		// Data
		employees: employeesQuery.data?.employees ?? [],
		total: employeesQuery.data?.total ?? 0,
		hasMore: employeesQuery.data?.hasMore ?? false,

		// Loading states
		isLoading: currentEmployeeQuery.isLoading || employeesQuery.isLoading,
		isFetching: employeesQuery.isFetching,
		isError: employeesQuery.isError,

		// Auth
		hasEmployee,
		isAdmin,

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
		pageCount: Math.ceil((employeesQuery.data?.total ?? 0) / pagination.pageSize) || 1,

		// Actions
		refresh,
	};
}
