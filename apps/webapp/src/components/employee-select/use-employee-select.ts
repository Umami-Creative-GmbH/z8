"use client";

import { useQuery } from "@tanstack/react-query";
import { startTransition, useEffect, useState } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import {
	type EmployeeSelectParams,
	getEmployeesByIds,
	listEmployeesForSelect,
	type SelectableEmployee,
} from "@/app/[locale]/(app)/settings/employees/actions";
import { useEmployeeClockStatuses } from "@/lib/query";
import { queryKeys } from "@/lib/query/keys";
import type { EmployeeSelectFilters } from "./types";

interface UseEmployeeSelectOptions {
	/** Pre-applied filters */
	filters?: EmployeeSelectFilters;
	/** IDs to exclude from results */
	excludeIds?: string[];
	/** Page size for pagination */
	pageSize?: number;
	/** Whether the modal is open (enables/disables query) */
	enabled?: boolean;
}

interface UseEmployeeSelectReturn {
	// Data
	employees: SelectableEmployee[];
	total: number;
	hasMore: boolean;

	// Loading states
	isLoading: boolean;
	isFetching: boolean;
	isError: boolean;

	// Search
	search: string;
	setSearch: (value: string) => void;
	debouncedSearch: string;

	// Filters
	roleFilter: string;
	setRoleFilter: (value: string) => void;
	statusFilter: string;
	setStatusFilter: (value: string) => void;
	teamFilter: string;
	setTeamFilter: (value: string) => void;

	// Pagination
	page: number;
	setPage: (page: number) => void;
	pageSize: number;
	pageCount: number;
	loadMore: () => void;

	// Actions
	refresh: () => void;
}

/**
 * Custom hook for employee selection with debounced search and pagination
 */
export function useEmployeeSelect(options: UseEmployeeSelectOptions = {}): UseEmployeeSelectReturn {
	const { filters, excludeIds = [], pageSize = 20, enabled = true } = options;

	// Search state with debouncing
	const [search, setSearchState] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");

	// Filter state
	const [roleFilter, setRoleFilter] = useState<string>(filters?.role || "all");
	const [statusFilter, setStatusFilter] = useState<string>(filters?.status || "all");
	const [teamFilter, setTeamFilter] = useState<string>(filters?.teamId || "");

	// Pagination state
	const [page, setPage] = useState(0);

	// Debounce search input (300ms)
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(search);
			setPage(0); // Reset to first page on search
		}, 300);

		return () => clearTimeout(timer);
	}, [search]);

	// Reset page when filters change
	// biome-ignore lint/correctness/useExhaustiveDependencies: we intentionally want to trigger on filter changes
	useEffect(() => {
		startTransition(() => setPage(0));
	}, [roleFilter, statusFilter, teamFilter]);

	// Get current employee for org context
	const currentEmployeeQuery = useQuery({
		queryKey: ["current-employee"],
		queryFn: getCurrentEmployee,
		staleTime: 5 * 60 * 1000,
	});

	const orgId = currentEmployeeQuery.data?.organizationId ?? "";
	const hasEmployee = !!currentEmployeeQuery.data;

	// Build query params
	const queryParams: EmployeeSelectParams = {
		search: debouncedSearch || undefined,
		role: roleFilter === "all" ? undefined : (roleFilter as EmployeeSelectParams["role"]),
		status: statusFilter === "all" ? undefined : (statusFilter as EmployeeSelectParams["status"]),
		teamId: teamFilter || undefined,
		excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
		limit: pageSize,
		offset: page * pageSize,
	};

	// Main employees query
	const employeesQuery = useQuery({
		queryKey: queryKeys.employeeSelect.list(orgId, queryParams),
		queryFn: async () => {
			const result = await listEmployeesForSelect(queryParams);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data;
		},
		enabled: enabled && hasEmployee && !!orgId,
		staleTime: 30 * 1000,
		placeholderData: (prev) => prev,
	});
	const employees = employeesQuery.data?.employees ?? [];
	const presence = useEmployeeClockStatuses(
		employees.map((employee) => employee.id),
		{ polling: false },
	);
	const employeesWithPresence = employees.map((employee) => ({
		...employee,
		clockStatus: presence.getStatus(employee.id),
	}));

	// Setters with page reset
	const setSearch = (value: string) => {
		setSearchState(value);
	};

	const setRoleFilterWithReset = (value: string) => {
		setRoleFilter(value);
	};

	const setStatusFilterWithReset = (value: string) => {
		setStatusFilter(value);
	};

	const setTeamFilterWithReset = (value: string) => {
		setTeamFilter(value);
	};

	const loadMore = () => {
		if (employeesQuery.data?.hasMore) {
			setPage((prev) => prev + 1);
		}
	};

	const refresh = () => {
		employeesQuery.refetch();
	};

	return {
		// Data
		employees: employeesWithPresence,
		total: employeesQuery.data?.total ?? 0,
		hasMore: employeesQuery.data?.hasMore ?? false,

		// Loading states
		isLoading: currentEmployeeQuery.isLoading || employeesQuery.isLoading,
		isFetching: employeesQuery.isFetching,
		isError: employeesQuery.isError,

		// Search
		search,
		setSearch,
		debouncedSearch,

		// Filters
		roleFilter,
		setRoleFilter: setRoleFilterWithReset,
		statusFilter,
		setStatusFilter: setStatusFilterWithReset,
		teamFilter,
		setTeamFilter: setTeamFilterWithReset,

		// Pagination
		page,
		setPage,
		pageSize,
		pageCount: Math.ceil((employeesQuery.data?.total ?? 0) / pageSize) || 1,
		loadMore,

		// Actions
		refresh,
	};
}

/**
 * Hook to fetch selected employees by their IDs
 * Used to display currently selected employees in the trigger
 */
export function useSelectedEmployees(employeeIds: string[]) {
	// Get current employee for org context
	const currentEmployeeQuery = useQuery({
		queryKey: ["current-employee"],
		queryFn: getCurrentEmployee,
		staleTime: 5 * 60 * 1000,
	});

	const hasEmployee = !!currentEmployeeQuery.data;

	// Stable key for the query
	const sortedIds = [...employeeIds].sort();

	const query = useQuery({
		queryKey: queryKeys.employeeSelect.byIds(sortedIds),
		queryFn: async () => {
			if (sortedIds.length === 0) return [];
			const result = await getEmployeesByIds(sortedIds);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data;
		},
		enabled: hasEmployee && sortedIds.length > 0,
		staleTime: 5 * 60 * 1000,
	});
	const selectedEmployees = query.data ?? [];
	const presence = useEmployeeClockStatuses(
		selectedEmployees.map((employee) => employee.id),
		{ polling: false },
	);
	const selectedEmployeesWithPresence = selectedEmployees.map((employee) => ({
		...employee,
		clockStatus: presence.getStatus(employee.id),
	}));

	return {
		employees: selectedEmployeesWithPresence,
		isLoading: query.isLoading,
		isError: query.isError,
	};
}
