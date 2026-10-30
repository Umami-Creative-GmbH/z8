"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo } from "react";
import {
	type EmployeeDetailRecord,
	requestEmployeeWorkBalanceRecalculation,
	updateEmployee,
	updateEmployeeInvitationDraft,
} from "@/app/[locale]/(app)/settings/employees/actions";
import {
	cancelEmployeeEmploymentHistoryAction,
	changeEmployeeWageAction,
	confirmEmployeeEmploymentHistoryAction,
	createEmployeeEmploymentHistoryAction,
} from "@/app/[locale]/(app)/settings/employees/employment-history-client-actions";
import { useOrganization } from "@/hooks/use-organization";
import { ApiError } from "@/lib/fetch";
import type { CustomFieldValuesInput } from "@/lib/organization/custom-fields/value-rules";
import {
	type EmployeeReadSnapshot,
	sameEmployeeReadScope,
} from "@/lib/organization/employee-read-types";
import type { SettingsAccessTier } from "@/lib/settings-access";
import type {
	UpdateEmployee,
	UpdateEmployeeInvitationDraft,
} from "@/lib/validations/employee";
import type {
	ChangeHourlyWage,
	UpsertEmploymentHistory,
} from "@/lib/validations/employment-history";
import { fetchEmployeeRead } from "./employee-read-client";
import { queryKeys } from "./keys";

export type EmployeeDetail = EmployeeDetailRecord;

/**
 * An employee detail save: the form's fields plus its custom field values (#818,
 * real employees only). Contract type and wage are saved for invitation drafts
 * only; an employee's change through employment terms.
 */
type EmployeeDetailUpdate = UpdateEmployee &
	Pick<UpdateEmployeeInvitationDraft, "contractType" | "hourlyRate"> & {
		customFieldValues?: CustomFieldValuesInput;
	};

interface UseEmployeeOptions {
	employeeId: string;
	enabled?: boolean;
	accessTier: SettingsAccessTier;
	organizationId?: string;
	userId?: string;
	initialSnapshot?: EmployeeReadSnapshot<"detail">;
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
	const organization = useOrganization();
	const userId = organization.userId;
	const organizationId =
		organization.activeOrganizationId ?? organization.organizationId;
	const hasEmployee =
		Boolean(organization.employeeId) || accessTier === "orgAdmin";
	const scope = userId && organizationId ? { userId, organizationId } : null;
	const canLoadEmployee =
		enabled &&
		hasEmployee &&
		!organization.isLoading &&
		Boolean(scope) &&
		(!options.organizationId || options.organizationId === organizationId) &&
		(!options.userId || options.userId === userId);
	const detailKey = useMemo(
		() => queryKeys.employees.detailFor(userId, organizationId, employeeId),
		[userId, organizationId, employeeId],
	);
	const initial =
		options.initialSnapshot &&
		sameEmployeeReadScope(options.initialSnapshot.scope, scope) &&
		(options.initialSnapshot.data.id === employeeId ||
			(options.initialSnapshot.data.kind === "invitationDraft" &&
				options.initialSnapshot.data.encodedId === employeeId))
			? options.initialSnapshot
			: undefined;
	const employeeQuery = useQuery({
		queryKey: detailKey,
		queryFn: ({ signal }) => {
			if (!scope) throw new ApiError("Employee context is unavailable", 401);
			return fetchEmployeeRead("detail", scope, { employeeId }, signal);
		},
		enabled: canLoadEmployee,
		initialData: initial,
		initialDataUpdatedAt: initial?.updatedAt,
		refetchOnMount: initial ? false : "always",
		staleTime: 30_000,
		retry: false,
		meta: { viewRefresh: initial ? "server" : "client" },
	});
	const initialIsNewer =
		initial &&
		(!employeeQuery.data || initial.updatedAt > employeeQuery.data.updatedAt);
	const snapshot = canLoadEmployee
		? initialIsNewer
			? initial
			: employeeQuery.isError
				? undefined
				: employeeQuery.data
		: undefined;
	const employee = snapshot?.data;
	useLayoutEffect(() => {
		if (!initial) return;
		const cached =
			queryClient.getQueryData<EmployeeReadSnapshot<"detail">>(detailKey);
		if (cached && cached.updatedAt >= initial.updatedAt) return;
		void queryClient
			.cancelQueries({ queryKey: detailKey, exact: true })
			.then(() => {
				const latest =
					queryClient.getQueryData<EmployeeReadSnapshot<"detail">>(detailKey);
				if (!latest || latest.updatedAt < initial.updatedAt)
					queryClient.setQueryData(detailKey, initial, {
						updatedAt: initial.updatedAt,
					});
			});
	}, [detailKey, initial, queryClient]);
	const isDraft =
		employee?.kind === "invitationDraft" || employeeId.startsWith("draft:");
	const hasRealEmployeeDetail = employee?.kind === "employee";
	const canLoadEmployeeDetails = canLoadEmployee && hasRealEmployeeDetail;
	const scheduleQuery = useQuery({
		queryKey: [...detailKey, "schedule"],
		queryFn: async ({ signal }) => {
			if (!scope) throw new ApiError("Employee context is unavailable", 401);
			return (
				await fetchEmployeeRead("schedule", scope, { employeeId }, signal)
			).data;
		},
		enabled: canLoadEmployeeDetails,
		staleTime: 60_000,
		retry: false,
	});
	const managersQuery = useQuery({
		queryKey: [...queryKeys.employees.managerChoices(
			userId,
			organizationId,
			employeeId,
		), accessTier],
		queryFn: async ({ signal }) => {
			if (!scope) throw new ApiError("Employee context is unavailable", 401);
			return (
				await fetchEmployeeRead("managers", scope, { employeeId }, signal)
			).data;
		},
		enabled: canLoadEmployeeDetails && accessTier === "orgAdmin",
		staleTime: 60_000,
		refetchOnMount: "always",
		retry: false,
	});

	const employmentHistoryQuery = useQuery({
		queryKey: [...detailKey, "employment-history"],
		queryFn: async ({ signal }) => {
			if (!scope) throw new ApiError("Employee context is unavailable", 401);
			return (
				await fetchEmployeeRead(
					"employment-history",
					scope,
					{ employeeId },
					signal,
				)
			).data;
		},
		enabled: canLoadEmployeeDetails,
		staleTime: 30_000,
		retry: false,
	});

	const workPoliciesQuery = useQuery({
		queryKey: queryKeys.employees.referencePolicies(userId, organizationId),
		queryFn: async ({ signal }) => {
			if (!scope) throw new ApiError("Employee context is unavailable", 401);
			return (await fetchEmployeeRead("work-policies", scope, {}, signal)).data;
		},
		enabled: canLoadEmployee && !isDraft,
		staleTime: 60_000,
		refetchOnMount: "always",
		retry: false,
	});
	const invalidateDetail = () =>
		queryClient.invalidateQueries({ queryKey: detailKey });

	const createEmploymentHistoryMutation = useMutation({
		mutationFn: async (data: UpsertEmploymentHistory) =>
			isDraft ? draftActionResult : createEmployeeEmploymentHistoryAction(employeeId, data),
		onSuccess: (result) => {
			if (result.success) {
				return invalidateDetail();
			}
		},
	});

	const confirmEmploymentHistoryMutation = useMutation({
		mutationFn: async (historyId: string) =>
			isDraft ? draftActionResult : confirmEmployeeEmploymentHistoryAction(employeeId, historyId),
		onSuccess: (result) => {
			if (result.success) {
				return invalidateDetail();
			}
		},
	});

	const cancelEmploymentHistoryMutation = useMutation({
		mutationFn: async (historyId: string) =>
			isDraft ? draftActionResult : cancelEmployeeEmploymentHistoryAction(employeeId, historyId),
		onSuccess: (result) => {
			if (result.success) {
				return invalidateDetail();
			}
		},
	});

	const requestWorkBalanceRecalculationMutation = useMutation({
		mutationFn: async () =>
			isDraft ? draftActionResult : requestEmployeeWorkBalanceRecalculation(employeeId),
		onSuccess: (result) => {
			if (result.success) {
				return invalidateDetail();
			}
		},
	});

	const changeWageMutation = useMutation({
		mutationFn: async (data: ChangeHourlyWage) =>
			isDraft ? draftActionResult : changeEmployeeWageAction(employeeId, data),
		onSuccess: (result) => {
			if (result.success) {
				return invalidateDetail();
			}
		},
	});

	// Update employee mutation
	const updateMutation = useMutation({
		mutationFn: async (input: EmployeeDetailUpdate) => {
			const { customFieldValues, contractType, hourlyRate, ...data } = input;
			const isAcceptedDraft =
				employee?.kind === "invitationDraft" &&
				Boolean(employee.realEmployeeId);

			if (isAcceptedDraft) {
				return {
					success: false,
					error: "Edit the active employee record for accepted invitations",
					code: "ValidationError",
				} as const;
			}

			return employee?.kind === "invitationDraft"
				? updateEmployeeInvitationDraft(employeeId, {
						...data,
						contractType,
						hourlyRate,
					})
				: updateEmployee(employeeId, data, customFieldValues);
		},
		onSuccess: (result) => {
			if (result.success) {
				return Promise.all([
					invalidateDetail(),
				queryClient.invalidateQueries({
						queryKey: ["employees", organizationId, "list", userId],
					}),
				queryClient.invalidateQueries({
						queryKey: queryKeys.customFields.section("employee", employeeId),
					}),
				]);
			}
		},
	});

	// Refetch employee data manually
	const refetch = () => {
		if (!canLoadEmployee || organization.error) return organization.refetch();
		return Promise.all([
			invalidateDetail(),
			queryClient.invalidateQueries({
				queryKey: queryKeys.employees.managerChoices(
					userId,
					organizationId,
					employeeId,
				),
				exact: false,
			}),
			queryClient.invalidateQueries({
				queryKey: queryKeys.employees.referencePolicies(userId, organizationId),
				exact: true,
			}),
		]).then(() => undefined);
	};
	const detailError = organization.error
		? new Error(organization.error)
		: enabled && !organization.isLoading && hasEmployee && !canLoadEmployee
			? new Error("Employee context changed. Refresh to continue.")
			: initialIsNewer
				? null
				: employeeQuery.error;

	return {
		// Employee data
		employee: employee ?? null,
		schedule:
			canLoadEmployeeDetails && !scheduleQuery.isError
				? (scheduleQuery.data ?? null)
				: null,
		availableManagers:
			canLoadEmployeeDetails && accessTier === "orgAdmin" && !managersQuery.isError
				? (managersQuery.data ?? [])
				: [],
		employmentHistory:
			canLoadEmployeeDetails && !employmentHistoryQuery.isError
				? (employmentHistoryQuery.data ?? [])
				: [],
		workPolicies:
			canLoadEmployee && !isDraft && !workPoliciesQuery.isError
				? (workPoliciesQuery.data ?? [])
				: [],

		// Loading states
		isLoading:
			organization.isLoading ||
			(canLoadEmployee && !snapshot && employeeQuery.isPending),
		isFetching: [
			employeeQuery,
			scheduleQuery,
			managersQuery,
			employmentHistoryQuery,
			workPoliciesQuery,
		].some((query) => query.isFetching),
		isLoadingEmploymentHistory:
			canLoadEmployeeDetails && employmentHistoryQuery.isPending,
		isLoadingSchedule: canLoadEmployeeDetails && scheduleQuery.isPending,
		isError: Boolean(detailError),
		error: detailError,
		readErrors: {
			schedule: scheduleQuery.error,
			managers: managersQuery.error,
			employmentHistory: employmentHistoryQuery.error,
			workPolicies: workPoliciesQuery.error,
		},

		// Auth state
		hasEmployee,
		isAdmin: accessTier === "orgAdmin",

		// Mutations
		updateEmployee: updateMutation.mutateAsync,
		isUpdating: updateMutation.isPending,
		changeWage: changeWageMutation.mutateAsync,
		isChangingWage: changeWageMutation.isPending,
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
