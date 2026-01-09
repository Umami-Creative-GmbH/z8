"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	bulkUpdateNotificationPreferences,
	getNotificationPreferences,
	updateNotificationPreference,
} from "@/app/[locale]/(app)/settings/notifications/actions";
import type {
	NotificationChannel,
	NotificationType,
	UserPreferencesResponse,
} from "@/lib/notifications/types";
import { queryKeys } from "@/lib/query/keys";

/**
 * Hook for managing notification preferences
 *
 * Uses server actions with Effect for type-safe error handling
 * and TanStack Query for caching and optimistic updates.
 */
export function useNotificationPreferences() {
	const queryClient = useQueryClient();

	// Fetch preferences using server action
	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.notifications.preferences(),
		queryFn: async (): Promise<UserPreferencesResponse> => {
			const result = await getNotificationPreferences();
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
	});

	// Update single preference with optimistic update
	const updatePreference = useMutation({
		mutationFn: async ({
			notificationType,
			channel,
			enabled,
		}: {
			notificationType: NotificationType;
			channel: NotificationChannel;
			enabled: boolean;
		}) => {
			const result = await updateNotificationPreference({
				notificationType,
				channel,
				enabled,
			});

			if (!result.success) {
				throw new Error(result.error);
			}

			return result;
		},
		onMutate: async ({ notificationType, channel, enabled }) => {
			// Cancel any outgoing refetches
			await queryClient.cancelQueries({
				queryKey: queryKeys.notifications.preferences(),
			});

			// Snapshot the previous value
			const previousData = queryClient.getQueryData<UserPreferencesResponse>(
				queryKeys.notifications.preferences(),
			);

			// Optimistically update
			if (previousData) {
				queryClient.setQueryData<UserPreferencesResponse>(queryKeys.notifications.preferences(), {
					...previousData,
					matrix: {
						...previousData.matrix,
						[notificationType]: {
							...previousData.matrix[notificationType],
							[channel]: enabled,
						},
					},
				});
			}

			return { previousData };
		},
		onError: (_err, _variables, context) => {
			// Rollback on error
			if (context?.previousData) {
				queryClient.setQueryData(queryKeys.notifications.preferences(), context.previousData);
			}
		},
		onSettled: () => {
			// Always refetch after error or success
			queryClient.invalidateQueries({
				queryKey: queryKeys.notifications.preferences(),
			});
		},
	});

	// Bulk update preferences
	const bulkUpdate = useMutation({
		mutationFn: async (
			preferences: Array<{
				notificationType: NotificationType;
				channel: NotificationChannel;
				enabled: boolean;
			}>,
		) => {
			const result = await bulkUpdateNotificationPreferences(preferences);

			if (!result.success) {
				throw new Error(result.error);
			}

			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.notifications.preferences(),
			});
		},
	});

	return {
		preferences: data?.preferences ?? [],
		matrix: data?.matrix ?? null,
		isLoading,
		error,
		updatePreference: updatePreference.mutate,
		updatePreferenceAsync: updatePreference.mutateAsync,
		isUpdating: updatePreference.isPending,
		bulkUpdatePreferences: bulkUpdate.mutate,
		bulkUpdatePreferencesAsync: bulkUpdate.mutateAsync,
		isBulkUpdating: bulkUpdate.isPending,
	};
}
