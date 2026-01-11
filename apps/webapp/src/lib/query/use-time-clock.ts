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
	isClockedIn: boolean;
	activeWorkPeriod: { id: string; startTime: Date } | null;
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
 * - Real-time elapsed seconds counter
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

	// Real-time elapsed seconds counter
	const [elapsedSeconds, setElapsedSeconds] = useState(0);

	useEffect(() => {
		if (!status?.activeWorkPeriod) {
			setElapsedSeconds(0);
			return;
		}

		const calculateElapsed = () => {
			if (!status?.activeWorkPeriod) return 0;
			const start = new Date(status.activeWorkPeriod.startTime);
			return Math.floor((Date.now() - start.getTime()) / 1000);
		};

		setElapsedSeconds(calculateElapsed());

		const interval = setInterval(() => {
			setElapsedSeconds(calculateElapsed());
		}, 1000);

		return () => clearInterval(interval);
	}, [status?.activeWorkPeriod]);

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
		mutationFn: clockOut,
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
		isClockedIn: status?.isClockedIn ?? false,
		activeWorkPeriod: status?.activeWorkPeriod ?? null,
		elapsedSeconds,

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
