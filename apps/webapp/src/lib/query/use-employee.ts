"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import {
	type EmployeeDetailRecord,
	getEmployee,
	listEmployeesForSelect,
	requestEmployeeWorkBalanceRecalculation,
	updateEmployee,
	updateEmployeeInvitationDraft,
} from "@/app/[locale]/(app)/settings/employees/actions";
import {
	cancelEmployeeEmploymentHistoryAction,
	confirmEmployeeEmploymentHistoryAction,
	createEmployeeEmploymentHistoryAction,
	listEmployeeEmploymentHistoryAction,
} from "@/app/[locale]/(app)/settings/employees/employment-history-client-actions";
import {
	createRateHistoryEntry,
	getEmployeeRateHistory,
	type RateHistoryEntry,
} from "@/app/[locale]/(app)/settings/employees/rate-actions";
import { getEmployeeEffectiveScheduleDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import type { SettingsAccessTier } from "@/lib/settings-access";
import type { CreateRateHistory, UpdateEmployee } from "@/lib/validations/employee";
import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";
import { queryKeys } from "./keys";

type Manager = {
	id: string;
	userId: string;
	user: {
		firstName: string | null;
		lastName: string | null;
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

export type EmployeeDetail = EmployeeDetailRecord & {
	managers?: ManagerRelation[];
};

interface UseEmployeeOptions {
	employeeId: string;
	enabled?: boolean;
	accessTier: SettingsAccessTier;
}

const draftActionResult = {
	success: false,
	error: "Invitation drafts do not support this action",
} as const;

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
	const { employeeId, enabled = true, accessTier } = options;
	const queryClient = useQueryClient();

	// Query for current employee (to check admin status)
	const currentEmployeeQuery = useQuery({
		queryKey: ["current-employee"],
		queryFn: getCurrentEmployee,
		enabled,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

	const hasEmployee = !!currentEmployeeQuery.data || accessTier === "orgAdmin";

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
	const isDraft = employeeQuery.data?.kind === "invitationDraft";
	const hasRealEmployeeDetail = employeeQuery.data?.kind === "employee";

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
		enabled: enabled && hasEmployee && hasRealEmployeeDetail,
		staleTime: 60 * 1000, // 1 minute
	});

	// Query for available managers (admins and managers, excluding current employee)
	const managersQuery = useQuery({
		queryKey: ["available-managers", employeeId],
		queryFn: async () => {
			const result = await listEmployeesForSelect({
				roles: ["admin", "manager"],
				excludeIds: [employeeId],
				limit: 1000,
			});

			if (!result.success) {
				return [];
			}

			return result.data?.employees ?? [];
		},
		enabled: enabled && hasEmployee && accessTier === "orgAdmin" && hasRealEmployeeDetail,
		staleTime: 60 * 1000, // 1 minute
	});

	// Query for rate history (only for hourly employees)
	const rateHistoryQuery = useQuery({
		queryKey: queryKeys.employees.rateHistory(employeeId),
		queryFn: async () => {
			const result = await getEmployeeRateHistory(employeeId);
			if (!result.success) {
				return [];
			}
			return result.data;
		},
		enabled:
			enabled &&
			hasEmployee &&
			hasRealEmployeeDetail &&
			employeeQuery.data?.contractType === "hourly",
		staleTime: 30 * 1000, // 30 seconds
	});

	const employmentHistoryQuery = useQuery({
		queryKey: queryKeys.employees.employmentHistory(employeeId),
		queryFn: async () => {
			const result = await listEmployeeEmploymentHistoryAction(employeeId);
			if (!result.success) return [];
			return result.data ?? [];
		},
		enabled: enabled && hasEmployee && hasRealEmployeeDetail,
		staleTime: 30 * 1000,
	});

	const _invalidateEmploymentHistoryQueries = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.employees.employmentHistory(employeeId),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.employees.detail(employeeId),
		});
	};

	const createEmploymentHistoryMutation = useMutation({
		mutationFn: (data: UpsertEmploymentHistory) =>
			isDraft ? draftActionResult : createEmployeeEmploymentHistoryAction(employeeId, data),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.employmentHistory(employeeId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.detail(employeeId),
				});
			}
		},
	});

	const confirmEmploymentHistoryMutation = useMutation({
		mutationFn: (historyId: string) =>
			isDraft ? draftActionResult : confirmEmployeeEmploymentHistoryAction(employeeId, historyId),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.employmentHistory(employeeId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.detail(employeeId),
				});
			}
		},
	});

	const cancelEmploymentHistoryMutation = useMutation({
		mutationFn: (historyId: string) =>
			isDraft ? draftActionResult : cancelEmployeeEmploymentHistoryAction(employeeId, historyId),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.employmentHistory(employeeId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.detail(employeeId),
				});
			}
		},
	});

	const requestWorkBalanceRecalculationMutation = useMutation({
		mutationFn: () =>
			isDraft ? draftActionResult : requestEmployeeWorkBalanceRecalculation(employeeId),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.detail(employeeId),
				});
			}
		},
	});

	// Update rate mutation
	const updateRateMutation = useMutation({
		mutationFn: (data: CreateRateHistory) =>
			isDraft ? draftActionResult : createRateHistoryEntry(employeeId, data),
		onSuccess: (result) => {
			if (result.success) {
				// Invalidate rate history and employee queries
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.rateHistory(employeeId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.detail(employeeId),
				});
			}
		},
	});

	// Update employee mutation
	const updateMutation = useMutation({
		mutationFn: (data: UpdateEmployee) => {
			const isAcceptedDraft =
				employeeQuery.data?.kind === "invitationDraft" && Boolean(employeeQuery.data.realEmployeeId);

			if (isAcceptedDraft) {
				return {
					success: false,
					error: "Edit the active employee record for accepted invitations",
					code: "ValidationError",
				} as const;
			}

			return employeeQuery.data?.kind === "invitationDraft"
				? updateEmployeeInvitationDraft(employeeId, data)
				: updateEmployee(employeeId, data);
		},
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
	const refetch = () => {
		return queryClient.invalidateQueries({
			queryKey: queryKeys.employees.detail(employeeId),
		});
	};

	return {
		// Employee data
		employee: employeeQuery.data ?? null,
		schedule: scheduleQuery.data ?? null,
		availableManagers: managersQuery.data ?? [],
		rateHistory: (rateHistoryQuery.data ?? []) as RateHistoryEntry[],
		employmentHistory: employmentHistoryQuery.data ?? [],

		// Loading states
		isLoading: currentEmployeeQuery.isLoading || employeeQuery.isLoading || scheduleQuery.isLoading,
		isFetching: employeeQuery.isFetching,
		isLoadingRateHistory: rateHistoryQuery.isLoading,
		isLoadingEmploymentHistory: employmentHistoryQuery.isLoading,
		isError: employeeQuery.isError,
		error: employeeQuery.error,

		// Auth state
		hasEmployee,
		isAdmin: accessTier === "orgAdmin",

		// Mutations
		updateEmployee: updateMutation.mutateAsync,
		isUpdating: updateMutation.isPending,
		updateRate: updateRateMutation.mutateAsync,
		isUpdatingRate: updateRateMutation.isPending,
		createEmploymentHistory: createEmploymentHistoryMutation.mutateAsync,
		isCreatingEmploymentHistory: createEmploymentHistoryMutation.isPending,
		confirmEmploymentHistory: confirmEmploymentHistoryMutation.mutateAsync,
		isConfirmingEmploymentHistory: confirmEmploymentHistoryMutation.isPending,
		cancelEmploymentHistory: cancelEmploymentHistoryMutation.mutateAsync,
		isCancelingEmploymentHistory: cancelEmploymentHistoryMutation.isPending,
		requestWorkBalanceRecalculation: requestWorkBalanceRecalculationMutation.mutateAsync,
		isRequestingWorkBalanceRecalculation: requestWorkBalanceRecalculationMutation.isPending,

		// Utilities
		refetch,
	};
}
