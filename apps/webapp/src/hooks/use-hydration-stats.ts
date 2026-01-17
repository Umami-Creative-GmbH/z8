"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	getHydrationStats,
	logWaterIntake,
	snoozeWaterReminder,
} from "@/app/[locale]/(app)/wellness/actions";
import { queryKeys } from "@/lib/query/keys";
import type { HydrationStats, LogWaterIntakeFormValues } from "@/lib/validations/wellness";

export interface UseHydrationStatsOptions {
	/**
	 * Whether to enable the query
	 * @default true
	 */
	enabled?: boolean;
}

/**
 * Hook for hydration stats and water intake logging
 *
 * Provides:
 * - Hydration stats query (streak, progress, etc.)
 * - Log water intake mutation
 * - Snooze reminder mutation
 */
export function useHydrationStats(options: UseHydrationStatsOptions = {}) {
	const { enabled = true } = options;
	const queryClient = useQueryClient();

	// Query for hydration stats
	const statsQuery = useQuery({
		queryKey: queryKeys.hydration.stats(),
		queryFn: async () => {
			const result = await getHydrationStats();
			if (!result.success) {
				throw new Error(result.error ?? "Failed to fetch hydration stats");
			}
			return result.data;
		},
		enabled,
		staleTime: 60 * 1000, // Consider fresh for 1 minute
		refetchOnWindowFocus: true,
	});

	// Log water intake mutation
	const logIntakeMutation = useMutation({
		mutationFn: async (data: LogWaterIntakeFormValues) => {
			const result = await logWaterIntake(data);
			if (!result.success) {
				throw new Error(result.error ?? "Failed to log water intake");
			}
			return result.data;
		},
		onSuccess: (data) => {
			// Optimistically update stats
			queryClient.setQueryData(queryKeys.hydration.stats(), (old: HydrationStats | undefined) => {
				if (!old || !data) return old;
				return {
					...old,
					todayIntake: data.todayIntake,
					goalProgress: data.goalProgress,
					currentStreak: data.currentStreak,
					longestStreak: data.longestStreak,
				};
			});
			// Then invalidate to ensure consistency
			queryClient.invalidateQueries({ queryKey: queryKeys.hydration.stats() });
			// Also invalidate reminder status
			queryClient.invalidateQueries({ queryKey: queryKeys.hydration.reminderStatus() });
		},
	});

	// Snooze reminder mutation
	const snoozeMutation = useMutation({
		mutationFn: async () => {
			const result = await snoozeWaterReminder();
			if (!result.success) {
				throw new Error(result.error ?? "Failed to snooze reminder");
			}
			return result.data;
		},
		onSuccess: (data) => {
			// Update stats with new snooze time
			queryClient.setQueryData(queryKeys.hydration.stats(), (old: HydrationStats | undefined) => {
				if (!old || !data) return old;
				return {
					...old,
					snoozedUntil: data.snoozedUntil,
				};
			});
			// Invalidate reminder status
			queryClient.invalidateQueries({ queryKey: queryKeys.hydration.reminderStatus() });
		},
	});

	// Refetch stats manually
	const refetchStats = useCallback(() => {
		return queryClient.invalidateQueries({ queryKey: queryKeys.hydration.stats() });
	}, [queryClient]);

	const stats = statsQuery.data;

	return {
		// Stats
		stats,
		isLoading: statsQuery.isLoading,
		isFetching: statsQuery.isFetching,
		isError: statsQuery.isError,

		// Derived state
		currentStreak: stats?.currentStreak ?? 0,
		longestStreak: stats?.longestStreak ?? 0,
		todayIntake: stats?.todayIntake ?? 0,
		dailyGoal: stats?.dailyGoal ?? 8,
		goalProgress: stats?.goalProgress ?? 0,
		snoozedUntil: stats?.snoozedUntil ?? null,
		goalMet: (stats?.goalProgress ?? 0) >= 100,

		// Mutations
		logIntake: logIntakeMutation.mutateAsync,
		snooze: snoozeMutation.mutateAsync,
		isLogging: logIntakeMutation.isPending,
		isSnoozing: snoozeMutation.isPending,
		isMutating: logIntakeMutation.isPending || snoozeMutation.isPending,

		// Utilities
		refetchStats,
	};
}
