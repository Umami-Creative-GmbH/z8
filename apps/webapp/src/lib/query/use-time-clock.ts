"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
	clockIn,
	clockOut,
	getTimeClockStatus,
	updateTimeEntryNotes,
} from "@/app/[locale]/(app)/time-tracking/actions";
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
 *
 * Note: For real-time elapsed seconds, use `useElapsedTimer` separately.
 * This prevents unnecessary re-renders in components that don't need the timer.
 */
export function useTimeClock(options: UseTimeClockOptions = {}) {
	const { initialData, enabled = true } = options;
	const queryClient = useQueryClient();

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

	// Clock in mutation
	const clockInMutation = useMutation({
		mutationFn: clockIn,
		onSuccess: (result) => {
			if (result.success) {
				// Invalidate and refetch status
				queryClient.invalidateQueries({ queryKey: queryKeys.timeClock.status() });
			}
		},
	});

	// Clock out mutation
	const clockOutMutation = useMutation({
		mutationFn: (params?: { projectId?: string; workCategoryId?: string }) =>
			clockOut(params?.projectId, params?.workCategoryId),
		onSuccess: (result) => {
			if (result.success) {
				// Optimistically clear the active work period
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
				// Then invalidate to ensure consistency
				queryClient.invalidateQueries({ queryKey: queryKeys.timeClock.status() });
			}
		},
	});

	// Update notes mutation
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

		// Mutations
		clockIn: clockInMutation.mutateAsync,
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
