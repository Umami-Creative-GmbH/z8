"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import {
	type EmployeeWithRelations,
	getEmployee,
	listEmployees,
	updateEmployee,
} from "@/app/[locale]/(app)/settings/employees/actions";
import { getEmployeeEffectiveScheduleDetails } from "@/app/[locale]/(app)/settings/work-schedules/assignment-actions";
import type { UpdateEmployee } from "@/lib/validations/employee";
import { queryKeys } from "./keys";

type Manager = {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	user: {
		name: string;
		email: string;
		image: string | null;
	};
};

type ManagerRelation = {
	id: string;
	isPrimary: boolean;
	manager: Manager;
};

export type EmployeeDetail = EmployeeWithRelations & {
	managers?: ManagerRelation[];
};

interface UseEmployeeOptions {
	employeeId: string;
	enabled?: boolean;
}

/**
 * Hook for fetching and mutating a single employee
 *
 * Provides:
 * - Employee data query with caching
 * - Current user admin status
 * - Available managers list
 * - Work schedule data
 * - Update mutation with automatic cache invalidation
 */
export function useEmployee(options: UseEmployeeOptions) {
	const { employeeId, enabled = true } = options;
	const queryClient = useQueryClient();

	// Query for current employee (to check admin status)
	const currentEmployeeQuery = useQuery({
		queryKey: ["current-employee"],
		queryFn: getCurrentEmployee,
		enabled,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

	const isAdmin = currentEmployeeQuery.data?.role === "admin";
	const hasEmployee = !!currentEmployeeQuery.data;

	// Query for employee details
	const employeeQuery = useQuery({
		queryKey: queryKeys.employees.detail(employeeId),
		queryFn: async () => {
			const result = await getEmployee(employeeId);
			if (!result.success) {
				throw new Error(result.error || "Failed to load employee");
			}
			return result.data as EmployeeDetail;
		},
		enabled: enabled && hasEmployee,
		staleTime: 30 * 1000, // 30 seconds
	});

	// Query for work schedule
	const scheduleQuery = useQuery({
		queryKey: [...queryKeys.employees.detail(employeeId), "schedule"],
		queryFn: async () => {
			const result = await getEmployeeEffectiveScheduleDetails(employeeId);
			if (!result.success) {
				return null;
			}
			return result.data;
		},
		enabled: enabled && hasEmployee,
		staleTime: 60 * 1000, // 1 minute
	});

	// Query for available managers (admins and managers, excluding current employee)
	const managersQuery = useQuery({
		queryKey: ["available-managers", employeeId],
		queryFn: async () => {
			const [adminsResult, managersResult] = await Promise.all([
				listEmployees({ role: "admin" }),
				listEmployees({ role: "manager" }),
			]);

			if (!adminsResult.success || !managersResult.success) {
				return [];
			}

			const allManagers = [
				...(adminsResult.data?.employees || []),
				...(managersResult.data?.employees || []),
			].filter((m) => m.id !== employeeId);

			return allManagers;
		},
		enabled: enabled && isAdmin,
		staleTime: 60 * 1000, // 1 minute
	});

	// Update employee mutation
	const updateMutation = useMutation({
		mutationFn: (data: UpdateEmployee) => updateEmployee(employeeId, data),
		onSuccess: (result) => {
			if (result.success) {
				// Invalidate employee queries to refetch updated data
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.detail(employeeId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.all,
				});
			}
		},
	});

	// Refetch employee data manually
	const refetch = useCallback(() => {
		return queryClient.invalidateQueries({
			queryKey: queryKeys.employees.detail(employeeId),
		});
	}, [queryClient, employeeId]);

	return {
		// Employee data
		employee: employeeQuery.data ?? null,
		schedule: scheduleQuery.data ?? null,
		availableManagers: managersQuery.data ?? [],

		// Loading states
		isLoading: currentEmployeeQuery.isLoading || employeeQuery.isLoading || scheduleQuery.isLoading,
		isFetching: employeeQuery.isFetching,
		isError: employeeQuery.isError,
		error: employeeQuery.error,

		// Auth state
		hasEmployee,
		isAdmin,

		// Mutations
		updateEmployee: updateMutation.mutateAsync,
		isUpdating: updateMutation.isPending,

		// Utilities
		refetch,
	};
}
