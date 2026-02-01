"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	checkRestPeriod,
	getComplianceStatus,
	getProactiveAlerts,
	getOvertimeStats,
	requestComplianceException,
	getMyExceptions,
	hasValidException,
} from "@/app/[locale]/(app)/settings/compliance/actions";
import type { ComplianceAlert, ComplianceStatus, OvertimeStats, RestPeriodCheckResult } from "@/db/schema";
import type { ExceptionWithDetails } from "@/lib/effect/services/compliance-guardrail.service";
import { queryKeys } from "@/lib/query/keys";

export interface UseComplianceStatusOptions {
	/**
	 * Current session duration in minutes (for proactive alerts)
	 */
	currentSessionMinutes?: number;
	/**
	 * Employee ID for query keys
	 */
	employeeId?: string;
	/**
	 * Whether to enable the queries
	 * @default true
	 */
	enabled?: boolean;
	/**
	 * Whether to enable real-time polling for alerts
	 * @default false
	 */
	enablePolling?: boolean;
	/**
	 * Polling interval in milliseconds (default 60 seconds)
	 */
	pollingInterval?: number;
}

/**
 * Hook for ArbZG compliance status monitoring
 *
 * Provides:
 * - Rest period check before clock-in
 * - Proactive alerts during active sessions
 * - Full compliance status
 * - Overtime statistics
 * - Exception request functionality
 */
export function useComplianceStatus(options: UseComplianceStatusOptions = {}) {
	const {
		currentSessionMinutes = 0,
		employeeId = "current",
		enabled = true,
		enablePolling = false,
		pollingInterval = 60000,
	} = options;
	const queryClient = useQueryClient();

	// Query for rest period check (before clock-in)
	const restPeriodQuery = useQuery({
		queryKey: queryKeys.compliance.restPeriod(employeeId),
		queryFn: async (): Promise<RestPeriodCheckResult> => {
			const result = await checkRestPeriod();
			if (!result.success) {
				throw new Error(result.error ?? "Failed to check rest period");
			}
			return result.data;
		},
		enabled,
		staleTime: 30 * 1000, // Fresh for 30 seconds
	});

	// Query for proactive alerts (during active session)
	// Note: currentSessionMinutes is NOT in the query key to avoid creating new cache entries every minute.
	// The refetchInterval handles periodic updates, and the value is passed to the server action.
	const alertsQuery = useQuery({
		queryKey: queryKeys.compliance.alerts(employeeId),
		queryFn: async (): Promise<ComplianceAlert[]> => {
			const result = await getProactiveAlerts(currentSessionMinutes);
			if (!result.success) {
				throw new Error(result.error ?? "Failed to get compliance alerts");
			}
			return result.data;
		},
		enabled: enabled && currentSessionMinutes > 0,
		staleTime: 30 * 1000,
		refetchInterval: enablePolling ? pollingInterval : false,
	});

	// Query for full compliance status
	const statusQuery = useQuery({
		queryKey: queryKeys.compliance.status(employeeId),
		queryFn: async (): Promise<ComplianceStatus> => {
			const result = await getComplianceStatus(currentSessionMinutes);
			if (!result.success) {
				throw new Error(result.error ?? "Failed to get compliance status");
			}
			return result.data;
		},
		enabled,
		staleTime: 60 * 1000,
		refetchInterval: enablePolling ? pollingInterval : false,
	});

	// Query for overtime statistics
	const overtimeQuery = useQuery({
		queryKey: queryKeys.compliance.overtime(employeeId),
		queryFn: async (): Promise<OvertimeStats> => {
			const result = await getOvertimeStats();
			if (!result.success) {
				throw new Error(result.error ?? "Failed to get overtime stats");
			}
			return result.data;
		},
		enabled,
		staleTime: 5 * 60 * 1000, // Fresh for 5 minutes
	});

	// Query for employee's own exceptions
	const myExceptionsQuery = useQuery({
		queryKey: queryKeys.compliance.exceptions.my(employeeId, false),
		queryFn: async (): Promise<ExceptionWithDetails[]> => {
			const result = await getMyExceptions(false);
			if (!result.success) {
				throw new Error(result.error ?? "Failed to get exceptions");
			}
			return result.data;
		},
		enabled,
		staleTime: 60 * 1000,
	});

	// Mutation for requesting an exception
	const requestExceptionMutation = useMutation({
		mutationFn: async (input: {
			exceptionType: "rest_period" | "overtime_daily" | "overtime_weekly" | "overtime_monthly";
			reason: string;
			plannedDurationMinutes?: number;
		}) => {
			const result = await requestComplianceException(input);
			if (!result.success) {
				throw new Error(result.error ?? "Failed to request exception");
			}
			return result.data;
		},
		onSuccess: () => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.exceptions.my(employeeId, false),
			});
		},
	});

	// Check for valid exception (for clock-in flow)
	const checkException = useCallback(
		async (exceptionType: string) => {
			const result = await hasValidException(exceptionType);
			if (!result.success) {
				return { hasException: false };
			}
			return result.data;
		},
		[],
	);

	// Refresh all compliance data
	const refreshAll = useCallback(() => {
		return Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.compliance.restPeriod(employeeId) }),
			queryClient.invalidateQueries({ queryKey: queryKeys.compliance.status(employeeId) }),
			queryClient.invalidateQueries({ queryKey: queryKeys.compliance.overtime(employeeId) }),
		]);
	}, [queryClient, employeeId]);

	// Derived state
	const restPeriodCheck = restPeriodQuery.data;
	const alerts = alertsQuery.data ?? [];
	const status = statusQuery.data;
	const overtime = overtimeQuery.data;
	const myExceptions = myExceptionsQuery.data ?? [];

	// Count alerts by severity
	const criticalAlerts = alerts.filter((a) => a.severity === "critical" || a.severity === "violation");
	const warningAlerts = alerts.filter((a) => a.severity === "warning");
	const hasViolations = alerts.some((a) => a.severity === "violation");
	const hasCriticalAlerts = criticalAlerts.length > 0;

	return {
		// Rest period check
		restPeriodCheck,
		canClockIn: restPeriodCheck?.canClockIn ?? true,
		restPeriodEnforcement: restPeriodCheck?.enforcement ?? "none",
		minutesUntilAllowed: restPeriodCheck?.minutesUntilAllowed,
		nextAllowedClockIn: restPeriodCheck?.nextAllowedClockIn,

		// Proactive alerts
		alerts,
		criticalAlerts,
		warningAlerts,
		hasViolations,
		hasCriticalAlerts,
		alertCount: alerts.length,

		// Full status
		status,
		isCompliant: status?.isCompliant ?? true,

		// Overtime stats
		overtime,
		dailyOvertimeMinutes: overtime?.daily.overtimeMinutes ?? 0,
		weeklyOvertimeMinutes: overtime?.weekly.overtimeMinutes ?? 0,
		monthlyOvertimeMinutes: overtime?.monthly.overtimeMinutes ?? 0,

		// Exceptions
		myExceptions,
		pendingExceptions: myExceptions.filter((e) => e.status === "pending"),
		approvedExceptions: myExceptions.filter((e) => e.status === "approved"),

		// Loading states
		isLoading:
			restPeriodQuery.isLoading ||
			statusQuery.isLoading ||
			overtimeQuery.isLoading,
		isFetching:
			restPeriodQuery.isFetching ||
			alertsQuery.isFetching ||
			statusQuery.isFetching,
		isError: restPeriodQuery.isError || statusQuery.isError,

		// Mutations
		requestException: requestExceptionMutation.mutateAsync,
		isRequestingException: requestExceptionMutation.isPending,

		// Utilities
		checkException,
		refreshAll,
	};
}
