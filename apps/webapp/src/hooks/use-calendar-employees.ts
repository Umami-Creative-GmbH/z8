"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	getCurrentEmployee,
	getManagedEmployees,
	type ManagedEmployee,
} from "@/app/[locale]/(app)/team/actions";
import type { SelectableEmployee } from "@/components/employee-select/types";
import { queryKeys } from "@/lib/query/keys";

/**
 * Result of useCalendarEmployees hook
 */
export interface UseCalendarEmployeesResult {
	/** List of employees available in the calendar selector */
	employees: SelectableEmployee[];
	/** Whether the data is currently loading */
	isLoading: boolean;
	/** Error if fetching failed */
	error: Error | null;
	/** Current employee (always first in the list if available) */
	currentEmployee: SelectableEmployee | null;
}

/**
 * Transform ManagedEmployee to SelectableEmployee format
 */
function transformManagedEmployee(emp: ManagedEmployee): SelectableEmployee {
	return {
		id: emp.id,
		userId: emp.userId,
		firstName: emp.firstName,
		lastName: emp.lastName,
		position: emp.position,
		role: emp.role,
		isActive: emp.isActive,
		teamId: emp.team?.id ?? null,
		user: {
			id: emp.user.id,
			name: emp.user.name,
			email: emp.user.email,
			image: emp.user.image,
		},
		team: emp.team,
	};
}

/**
 * Transform a raw employee record to SelectableEmployee format
 */
function transformCurrentEmployee(emp: {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	teamId: string | null;
}): SelectableEmployee {
	return {
		id: emp.id,
		userId: emp.userId,
		firstName: emp.firstName,
		lastName: emp.lastName,
		position: emp.position,
		role: emp.role,
		isActive: emp.isActive,
		teamId: emp.teamId,
		// We don't have full user data here, so create a minimal version
		user: {
			id: emp.userId,
			name: emp.firstName && emp.lastName ? `${emp.firstName} ${emp.lastName}` : null,
			email: "", // Will be filled from session or context elsewhere
			image: null,
		},
		team: null, // Will be enhanced if needed
	};
}

interface CalendarEmployeesData {
	currentEmployee: SelectableEmployee | null;
	managedEmployees: SelectableEmployee[];
}

/**
 * Hook to fetch employees available for the calendar selector.
 *
 * Returns:
 * - Current user's employee record (always first)
 * - All employees the current user manages (via employeeManagers junction)
 *
 * Uses React Query for caching with 5-minute stale time since
 * employee lists don't change frequently.
 *
 * @param currentEmployeeId - The current user's employee ID (used for query key)
 */
export function useCalendarEmployees(currentEmployeeId?: string): UseCalendarEmployeesResult {
	const {
		data,
		isLoading,
		error,
	} = useQuery<CalendarEmployeesData>({
		// Use empty string when disabled - query won't run anyway
		queryKey: queryKeys.calendar.employees(currentEmployeeId ?? ""),
		queryFn: async () => {
			// Fetch current employee and managed employees in parallel
			const [currentEmp, managedResult] = await Promise.all([
				getCurrentEmployee(),
				getManagedEmployees(),
			]);

			// Transform current employee if available
			let currentEmployee: SelectableEmployee | null = null;
			if (currentEmp) {
				currentEmployee = transformCurrentEmployee(currentEmp);
			}

			// Handle managed employees result
			const managedEmployees: SelectableEmployee[] = [];
			if (managedResult.success && managedResult.data) {
				for (const emp of managedResult.data) {
					// Skip if this is the current employee (avoid duplicate)
					if (currentEmp && emp.id === currentEmp.id) continue;
					managedEmployees.push(transformManagedEmployee(emp));
				}
			}

			return {
				currentEmployee,
				managedEmployees,
			};
		},
		staleTime: 5 * 60 * 1000, // 5 minutes - employee lists don't change frequently
		enabled: !!currentEmployeeId,
	});

	// Combine current employee + managed employees into single list
	// Current employee is always first
	const employees = useMemo(() => {
		if (!data) return [];

		const list: SelectableEmployee[] = [];

		// Add current employee first (if available)
		if (data.currentEmployee) {
			list.push(data.currentEmployee);
		}

		// Add managed employees (sorted alphabetically)
		const sortedManaged = [...data.managedEmployees].sort((a, b) => {
			const nameA = a.firstName || a.user.name || a.user.email;
			const nameB = b.firstName || b.user.name || b.user.email;
			return (nameA ?? "").localeCompare(nameB ?? "");
		});

		list.push(...sortedManaged);

		return list;
	}, [data]);

	return {
		employees,
		isLoading,
		error: error instanceof Error ? error : null,
		currentEmployee: data?.currentEmployee ?? null,
	};
}
