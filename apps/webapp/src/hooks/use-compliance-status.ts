"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	hasValidException,
	requestComplianceException,
} from "@/app/[locale]/(app)/settings/compliance/actions";
import { useOrganization } from "@/hooks/use-organization";
import { ApiError } from "@/lib/fetch";
import { fetchClockCompliance } from "@/lib/query/clock-compliance-client";
import { queryKeys } from "@/lib/query/keys";

export interface UseComplianceStatusOptions {
	/**
	 * Current session duration in minutes (for proactive alerts)
	 */
	currentSessionMinutes?: number;
	/** Whether the clock is currently running; selects the visible advisory data. */
	isClockedIn?: boolean;
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

async function checkException(exceptionType: string) {
	const result = await hasValidException({ exceptionType });
	if (!result.success) {
		return { hasException: false };
	}
	return result.data;
}

/**
 * Hook for ArbZG compliance status monitoring
 *
 * Provides:
 * - Rest period check before clock-in
 * - Proactive alerts during active sessions
 * - Exception request functionality
 */
export function useComplianceStatus(options: UseComplianceStatusOptions = {}) {
	const {
		currentSessionMinutes = 0,
		isClockedIn: requestedIsClockedIn,
		employeeId,
		enabled = true,
		enablePolling = false,
		pollingInterval = 60000,
	} = options;
	const isClockedIn = requestedIsClockedIn ?? currentSessionMinutes > 0;
	const queryClient = useQueryClient();
	const organization = useOrganization();
	const userId = organization.userId;
	const organizationId = organization.activeOrganizationId;
	const currentEmployeeId = organization.employeeId;
	const scope =
		userId && organizationId && currentEmployeeId
			? { userId, organizationId, employeeId: currentEmployeeId }
			: null;
	const mode = isClockedIn ? "active" : "idle";
	const scopeKey = queryKeys.compliance.clockScope(userId, organizationId, currentEmployeeId);
	const queryKey = queryKeys.compliance.clock(userId, organizationId, currentEmployeeId, mode);
	const canLoad =
		enabled &&
		!organization.isLoading &&
		!!scope &&
		(!employeeId || employeeId === currentEmployeeId);
	const snapshotQuery = useQuery({
		queryKey,
		queryFn: ({ signal }) => {
			if (!scope) throw new ApiError("Employee context is unavailable", 401);
			return fetchClockCompliance(scope, mode, currentSessionMinutes, signal);
		},
		enabled: canLoad,
		// Returning to idle after clock-out must reread the new rest boundary,
		// even when an idle snapshot was fetched only a few seconds ago.
		staleTime: 0,
		refetchOnMount: "always",
		retry: false,
		// Minutes are an input, not a cache dimension; polling reuses the active key.
		refetchInterval: enablePolling && isClockedIn ? pollingInterval : false,
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
			return queryClient.invalidateQueries({ queryKey: scopeKey });
		},
	});

	// Refresh all compliance data
	const refreshAll = () => queryClient.invalidateQueries({ queryKey: scopeKey });

	// Derived state
	const snapshot = canLoad ? snapshotQuery.data : undefined;
	const restPeriodCheck = snapshot?.restPeriod ?? undefined;
	const alerts = snapshot?.alerts ?? [];
	const myExceptions = snapshot?.myExceptions ?? [];

	// Count alerts by severity
	const criticalAlerts = alerts.filter(
		(a) => a.severity === "critical" || a.severity === "violation",
	);
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

		// Exceptions
		myExceptions,
		pendingExceptions: myExceptions.filter((e) => e.status === "pending"),
		approvedExceptions: myExceptions.filter((e) => e.status === "approved"),

		// Loading states
		isLoading: enabled && (organization.isLoading || snapshotQuery.isLoading),
		isFetching: snapshotQuery.isFetching,
		isError: snapshotQuery.isError || !!organization.error,

		// Mutations
		requestException: requestExceptionMutation.mutateAsync,
		isRequestingException: requestExceptionMutation.isPending,

		// Utilities
		checkException,
		refreshAll,
	};
}
