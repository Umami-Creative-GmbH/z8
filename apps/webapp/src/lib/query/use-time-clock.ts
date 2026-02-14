"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
	clockIn,
	clockOut,
	getTimeClockStatus,
	updateTimeEntryNotes,
} from "@/app/[locale]/(app)/time-tracking/actions";
import { useOfflineClock } from "@/hooks/use-offline-clock";
import { queryKeys } from "./keys";

export interface TimeClockState {
	hasEmployee: boolean;
	employeeId: string | null;
	isClockedIn: boolean;
	activeWorkPeriod: { id: string; startTime: Date } | null;
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
	const [elapsedSeconds, setElapsedSeconds] = useState(() => {
		if (!startTime) return 0;
		return Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
	});

	useEffect(() => {
		if (!startTime) {
			setElapsedSeconds(0);
			return;
		}

		const calculateElapsed = () => {
			const start = new Date(startTime);
			return Math.floor((Date.now() - start.getTime()) / 1000);
		};

		setElapsedSeconds(calculateElapsed());

		const interval = setInterval(() => {
			setElapsedSeconds(calculateElapsed());
		}, 1000);

		return () => clearInterval(interval);
	}, [startTime]);

	return elapsedSeconds;
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

	// Offline support
	const {
		isOnline,
		isOffline,
		pendingCount,
		isSyncing,
		queueClockEvent,
	} = useOfflineClock();

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
		mutationFn: async (params: { workLocationType?: "office" | "home" | "field" | "other" }) => {
			// When offline, queue the event for later sync
			if (isOffline) {
				const result = await queueClockEvent({
					type: "clock_in",
					timestamp: Date.now(),
					organizationId: "pending", // Will be resolved on sync
				});

				if (result.success) {
					// Optimistically update the UI immediately
					queryClient.setQueryData(
						queryKeys.timeClock.status(),
						(old: TimeClockState | undefined) => {
							if (!old) return old;
							return {
								...old,
								isClockedIn: true,
								activeWorkPeriod: {
									id: `pending-${Date.now()}`,
									startTime: new Date(),
								},
							};
						},
					);

					// Return success without data (queued case)
					// The toast in the hook will notify the user
					return { success: true as const, queued: true };
				}
				return {
					success: false as const,
					error: result.error || "Failed to queue clock event",
				};
			}

			// Online - use normal server action
			return clockIn(params?.workLocationType);
		},
		onSuccess: (result) => {
			if (result.success && !("queued" in result)) {
				// Only invalidate for non-queued success (server confirmed)
				queryClient.invalidateQueries({ queryKey: queryKeys.timeClock.status() });
			}
		},
	});

	// Clock out mutation with offline support
	const clockOutMutation = useMutation({
		mutationFn: async (params?: { projectId?: string; workCategoryId?: string }) => {
			// When offline, queue the event for later sync
			if (isOffline) {
				const result = await queueClockEvent({
					type: "clock_out",
					timestamp: Date.now(),
					organizationId: "pending", // Will be resolved on sync
					projectId: params?.projectId,
					workCategoryId: params?.workCategoryId,
				});

				if (result.success) {
					// Optimistically update the UI immediately
					queryClient.setQueryData(
						queryKeys.timeClock.status(),
						(old: TimeClockState | undefined) => {
							if (!old) return old;
							return {
								...old,
								isClockedIn: false,
								activeWorkPeriod: null,
							};
						},
					);

					// Return success without data (queued case)
					return { success: true as const, queued: true };
				}
				return {
					success: false as const,
					error: result.error || "Failed to queue clock event",
				};
			}

			// Online - use normal server action
			return clockOut(params?.projectId, params?.workCategoryId);
		},
		onSuccess: (result) => {
			if (result.success && !("queued" in result)) {
				// Only invalidate for non-queued success (server confirmed)
				queryClient.invalidateQueries({ queryKey: queryKeys.timeClock.status() });
			}
		},
	});

	// Update notes mutation (online only - notes are secondary)
	const updateNotesMutation = useMutation({
		mutationFn: ({ entryId, notes }: { entryId: string; notes: string }) =>
			updateTimeEntryNotes(entryId, notes),
	});

	// Refetch status manually
	const refetchStatus = useCallback(() => {
		return queryClient.invalidateQueries({ queryKey: queryKeys.timeClock.status() });
	}, [queryClient]);

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
		pendingCount,
		isSyncing,

		// Mutations
		clockIn: (params?: { workLocationType?: "office" | "home" | "field" | "other" }) =>
			clockInMutation.mutateAsync(params ?? {}),
		clockOut: clockOutMutation.mutateAsync,
		updateNotes: updateNotesMutation.mutateAsync,
		isClockingIn: clockInMutation.isPending,
		isClockingOut: clockOutMutation.isPending,
		isUpdatingNotes: updateNotesMutation.isPending,
		isMutating:
			clockInMutation.isPending || clockOutMutation.isPending || updateNotesMutation.isPending,

		// Utilities
		refetchStatus,
	};
}
