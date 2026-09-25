"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	addBreakToActiveSession,
	getTimeClockStatus,
	updateTimeEntryNotes,
} from "@/app/[locale]/(app)/time-tracking/actions";
import { useOfflineClock } from "@/hooks/use-offline-clock";
import { useSession } from "@/lib/auth-client";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import {
	frozenClockCommandsAvailable,
	prepareBrowserClockCommand,
} from "@/lib/time-tracking/browser-clock-command";
import { postClockIn, postClockOut } from "@/lib/time-tracking/time-clock-client";
import { getBrowserTimezone } from "@/lib/time-tracking/timezone-capture";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import { queryKeys } from "./keys";

export interface TimeClockState {
	hasEmployee: boolean;
	employeeId: string | null;
	isClockedIn: boolean;
	activeWorkPeriod: { id: string; startTime: Date } | null;
}

function subscribeToSecondTick(onStoreChange: () => void) {
	const interval = window.setInterval(onStoreChange, 1000);
	return () => window.clearInterval(interval);
}

function getCurrentEpochSecond() {
	return Math.floor(systemClock.nowInstant().epochMilliseconds / 1000);
}

function getServerEpochSecond() {
	return 0;
}

function resolveBrowserTimezone(params?: { browserTimezone?: string | null }) {
	return params && "browserTimezone" in params
		? params.browserTimezone
		: getBrowserTimezone();
}

/**
 * Separate hook for elapsed time counter (rerender-derived-state)
 * Only components that need the real-time counter should use this hook.
 * This prevents unnecessary re-renders in components that only need
 * clock status without the per-second timer updates.
 *
 * @param startTime - The start time to calculate elapsed seconds from, or null if not clocked in
 * @returns The elapsed seconds since startTime, updating every second
 */
export function useElapsedTimer(startTime: Date | null): number {
	const currentEpochSecond = useSyncExternalStore(
		subscribeToSecondTick,
		getCurrentEpochSecond,
		getServerEpochSecond,
	);
	if (!startTime || currentEpochSecond === 0) return 0;

	const startEpochSecond = Math.floor(
		instantFromDate(startTime).epochMilliseconds / 1000,
	);
	return Math.max(0, currentEpochSecond - startEpochSecond);
}

interface UseTimeClockOptions {
	/**
	 * Initial data from server-side rendering
	 * If provided, the query will use this as initial data
	 */
	initialData?: TimeClockState | null;
	/**
	 * Whether to enable the query
	 * @default true
	 */
	enabled?: boolean;
}

/**
 * Hook for time clock status and mutations
 *
 * Provides:
 * - Time clock status query with caching
 * - Clock in/out mutations with automatic cache invalidation
 * - Offline support with automatic queuing
 *
 * Note: For real-time elapsed seconds, use `useElapsedTimer` separately.
 * This prevents unnecessary re-renders in components that don't need the timer.
 */
export function useTimeClock(options: UseTimeClockOptions = {}) {
	const { initialData, enabled = true } = options;
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const activeOrganizationId = session?.session.activeOrganizationId;

	// Offline support
	const {
		isOnline,
		isOffline,
		pendingCount,
		isSyncing,
		queueClockEvent,
		commandCapabilities,
		submitClockCommand,
	} = useOfflineClock();
	const pageSession =
		session?.user?.id && activeOrganizationId && typeof window !== "undefined"
			? {
					userId: session.user.id,
					organizationId: activeOrganizationId,
					origin: window.location.origin,
				}
			: null;
	const canFreeze =
		pageSession !== null && frozenClockCommandsAvailable(commandCapabilities, pageSession);

	/**
	 * The frozen v2 command for this action (#279), or null to keep the legacy
	 * path. Identity, instant and zone are fixed here, before anything is sent.
	 */
	function prepareFrozenCommand(
		kind: "clock_in" | "clock_out",
		params?: {
			workLocationType?: WorkLocationType;
			browserTimezone?: string | null;
			projectId?: string;
			workCategoryId?: string;
		},
	) {
		if (!canFreeze || !pageSession) return null;
		const prepared = prepareBrowserClockCommand({
			kind,
			operationId: crypto.randomUUID(),
			capabilities: commandCapabilities,
			session: pageSession,
			now: systemClock.nowInstant(),
			timezone: resolveBrowserTimezone(params),
			workLocationType: params?.workLocationType,
			knownWorkPeriodId: statusQuery.data?.activeWorkPeriod?.id ?? null,
			projectId: params?.projectId,
			workCategoryId: params?.workCategoryId,
		});
		return prepared.ok ? prepared.request : null;
	}

	// Query for time clock status
	const statusQuery = useQuery({
		queryKey: queryKeys.timeClock.status(),
		queryFn: getTimeClockStatus,
		initialData: initialData ?? undefined,
		enabled,
		staleTime: 30 * 1000, // Consider fresh for 30 seconds
		refetchOnWindowFocus: true, // Refetch when user comes back to tab
	});

	const status = statusQuery.data;

	// Clock in mutation with offline support
	const clockInMutation = useMutation({
		networkMode: "always", // Local IndexedDB capture must run while TanStack is offline.
		mutationFn: async (params?: {
			workLocationType?: WorkLocationType;
			browserTimezone?: string | null;
		}) => {
			const frozen = prepareFrozenCommand("clock_in", params);
			if (frozen) return submitClockCommand(frozen);

			// When offline, queue the event for later sync
			if (isOffline) {
				if (!activeOrganizationId) {
					return { success: false as const, error: "No active organization" };
				}

				const browserTimezone = resolveBrowserTimezone(params);
				const result = await queueClockEvent({
					type: "clock_in",
					timestamp: systemClock.nowInstant().epochMilliseconds,
					organizationId: activeOrganizationId,
					workLocationType: params?.workLocationType,
					browserTimezone,
				});

				if (result.success) {
					// Local retention is not an active server work period.
					return { success: true as const, queued: true, reviewRequired: true };
				}
				return {
					success: false as const,
					error: result.error || "Failed to queue clock event",
				};
			}

			// Online - use the route handler; server action IDs change per deployment
			return postClockIn({
				workLocationType: params?.workLocationType,
				browserTimezone: resolveBrowserTimezone(params),
			});
		},
		onSuccess: (result) => {
			if (result.success && !("queued" in result)) {
				// Only invalidate for non-queued success (server confirmed)
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.status(),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employeeClockStatuses.all,
				});
				if (status?.employeeId) {
					void queryClient.invalidateQueries({
						queryKey: queryKeys.workPolicies.presence.status(status.employeeId),
					});
				}
			}
		},
	});

	// Clock out mutation with offline support
	const clockOutMutation = useMutation({
		networkMode: "always",
		mutationFn: async (params?: {
			projectId?: string;
			workCategoryId?: string;
			browserTimezone?: string | null;
			submissionId?: string;
		}) => {
			const frozen = prepareFrozenCommand("clock_out", params);
			if (frozen) return submitClockCommand(frozen);

			// When offline, queue the event for later sync
			if (isOffline) {
				if (!activeOrganizationId) {
					return { success: false as const, error: "No active organization" };
				}

				const browserTimezone = resolveBrowserTimezone(params);
				const result = await queueClockEvent({
					type: "clock_out",
					timestamp: systemClock.nowInstant().epochMilliseconds,
					organizationId: activeOrganizationId,
					projectId: params?.projectId,
					workCategoryId: params?.workCategoryId,
					browserTimezone,
				});

				if (result.success) {
					return { success: true as const, queued: true, reviewRequired: true };
				}
				return {
					success: false as const,
					error: result.error || "Failed to queue clock event",
				};
			}

			// Online - use the route handler; server action IDs change per deployment
			return postClockOut({
				projectId: params?.projectId,
				workCategoryId: params?.workCategoryId,
				browserTimezone: resolveBrowserTimezone(params),
				submissionId: params?.submissionId as string,
			});
		},
		onSuccess: (result) => {
			if (result.success && !("queued" in result)) {
				// Only invalidate for non-queued success (server confirmed)
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.status(),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employeeClockStatuses.all,
				});
				if (status?.employeeId) {
					void queryClient.invalidateQueries({
						queryKey: queryKeys.workPolicies.presence.status(status.employeeId),
					});
				}
			}
		},
	});

	// Update notes mutation (online only - notes are secondary)
	const updateNotesMutation = useMutation({
		mutationFn: ({ entryId, notes }: { entryId: string; notes: string }) =>
			updateTimeEntryNotes(entryId, notes),
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.status(),
				});
			}
		},
	});

	// Add break mutation (online only - break changes must be confirmed immediately)
	const addBreakMutation = useMutation({
		mutationFn: async ({
			breakMinutes,
			submissionId,
		}: {
			breakMinutes: number;
			submissionId: string;
		}) => {
			if (isOffline) {
				return {
					success: false as const,
					error: "Adding a break requires an internet connection.",
				};
			}

			return addBreakToActiveSession(breakMinutes, {
				submissionId,
				browserTimezone: getBrowserTimezone(),
			});
		},
		onSuccess: (result) => {
			if (result.success) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.status(),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeClock.breakStatus(),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.employeeClockStatuses.all,
				});
			}
		},
	});

	// Refetch status manually
	const refetchStatus = () => {
		return queryClient.invalidateQueries({
			queryKey: queryKeys.timeClock.status(),
		});
	};

	return {
		// Status
		status,
		isLoading: statusQuery.isLoading,
		isFetching: statusQuery.isFetching,
		isError: statusQuery.isError,

		// Derived state
		hasEmployee: status?.hasEmployee ?? false,
		employeeId: status?.employeeId ?? null,
		isClockedIn: status?.isClockedIn ?? false,
		activeWorkPeriod: status?.activeWorkPeriod ?? null,

		// Offline state
		isOnline,
		isOffline,
		captureMode: !isOffline
			? ("server" as const)
			: canFreeze
				? ("local-queue" as const)
				: ("local-review" as const),
		pendingCount,
		isSyncing,

		// Mutations
		clockIn: (params?: {
			workLocationType?: WorkLocationType;
			browserTimezone?: string | null;
		}) => clockInMutation.mutateAsync(params ?? {}),
		clockOut: (params?: {
			projectId?: string;
			workCategoryId?: string;
			browserTimezone?: string | null;
		}) =>
			clockOutMutation.mutateAsync({
				...(params ?? {}),
				...(!isOffline ? { submissionId: crypto.randomUUID() } : {}),
			}),
		// One identity per request, as for clock-out; the server replays a committed identity.
		addBreak: (params: { breakMinutes: number }) =>
			addBreakMutation.mutateAsync({ ...params, submissionId: crypto.randomUUID() }),
		updateNotes: updateNotesMutation.mutateAsync,
		isClockingIn: clockInMutation.isPending,
		isClockingOut: clockOutMutation.isPending,
		isAddingBreak: addBreakMutation.isPending,
		isUpdatingNotes: updateNotesMutation.isPending,
		isMutating:
			clockInMutation.isPending ||
			clockOutMutation.isPending ||
			addBreakMutation.isPending ||
			updateNotesMutation.isPending,

		// Utilities
		refetchStatus,
	};
}
