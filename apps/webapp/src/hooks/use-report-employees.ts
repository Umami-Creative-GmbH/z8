"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getAccessibleEmployeesAction } from "@/app/[locale]/(app)/reports/actions";
import type { SelectableEmployee } from "@/components/employee-select/types";
import { queryKeys } from "@/lib/query/keys";
import type { AccessibleEmployee } from "@/lib/reports/types";

/**
 * Result of useReportEmployees hook
 */
export interface UseReportEmployeesResult {
	/** List of employees accessible for report generation */
	employees: SelectableEmployee[];
	/** Whether the data is currently loading */
	isLoading: boolean;
	/** Error if fetching failed */
	error: Error | null;
	/** Current employee (always first in the list if available) */
	currentEmployee: SelectableEmployee | null;
	/** Whether the current user can see multiple employees (manager/admin) */
	canViewMultiple: boolean;
}

/**
 * Transform AccessibleEmployee to SelectableEmployee format
 */
function transformAccessibleEmployee(emp: AccessibleEmployee): SelectableEmployee {
	return {
		id: emp.id,
		userId: emp.id, // Use same ID as seed for avatar
		firstName: null,
		lastName: null,
		position: emp.position,
		role: emp.role,
		isActive: true,
		teamId: null,
		user: {
			id: emp.id,
			name: emp.name,
			email: emp.email,
			image: null,
		},
		team: null,
	};
}

/**
 * Hook to fetch employees accessible for report generation.
 *
 * Returns employees based on the current user's role:
 * - Employees: Only themselves (canViewMultiple: false)
 * - Managers: Themselves + managed employees (canViewMultiple: true)
 * - Admins: All employees in organization (canViewMultiple: true)
 *
 * Uses React Query for caching with 5-minute stale time since
 * employee lists don't change frequently.
 *
 * @param currentEmployeeId - The current user's employee ID (used for query key)
 */
export function useReportEmployees(currentEmployeeId?: string): UseReportEmployeesResult {
	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.reports.employees(currentEmployeeId ?? ""),
		queryFn: async () => {
			const result = await getAccessibleEmployeesAction();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch accessible employees");
			}
			return result.data;
		},
		staleTime: 5 * 60 * 1000, // 5 minutes - employee lists don't change frequently
		enabled: !!currentEmployeeId,
	});

	// Transform AccessibleEmployee[] to SelectableEmployee[]
	const employees = useMemo(() => {
		if (!data) return [];
		return data.map(transformAccessibleEmployee);
	}, [data]);

	// First employee is always the current user
	const currentEmployee = employees.length > 0 ? employees[0] : null;

	// Can view multiple if more than one employee in the list
	const canViewMultiple = employees.length > 1;

	return {
		employees,
		isLoading,
		error: error instanceof Error ? error : null,
		currentEmployee,
		canViewMultiple,
	};
}
