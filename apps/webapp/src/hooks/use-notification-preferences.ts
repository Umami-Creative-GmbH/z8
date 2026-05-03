"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	bulkUpdateNotificationPreferences,
	getNotificationPreferences,
	updateNotificationPreference,
} from "@/app/[locale]/(app)/settings/notifications/actions";
import { useSession } from "@/lib/auth-client";
import type {
	NotificationChannel,
	NotificationType,
	UserPreferencesResponse,
} from "@/lib/notifications/types";
import { queryKeys } from "@/lib/query/keys";

const DEFAULT_AVAILABLE_CHANNELS: UserPreferencesResponse["availableChannels"] = {
	in_app: true,
	push: true,
	email: true,
	teams: false,
	telegram: false,
	discord: false,
	slack: false,
};

/**
 * Hook for managing notification preferences
 *
 * Uses server actions with Effect for type-safe error handling
 * and TanStack Query for caching and optimistic updates.
 */
export function useNotificationPreferences() {
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const activeOrganizationId = session?.session?.activeOrganizationId ?? null;
	const preferencesQueryKey = queryKeys.notifications.preferences(activeOrganizationId);
	const preferencesQueryKeyPrefix = queryKeys.notifications.preferences();

	// Fetch preferences using server action
	const { data, isLoading, error } = useQuery({
		queryKey: preferencesQueryKey,
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
				queryKey: preferencesQueryKeyPrefix,
			});

			// Snapshot all org-scoped caches because preference values are user-level.
			const previousPreferenceQueries = queryClient.getQueriesData<UserPreferencesResponse>({
				queryKey: preferencesQueryKeyPrefix,
			});

			// Optimistically update every cached organization response.
			queryClient.setQueriesData<UserPreferencesResponse>(
				{ queryKey: preferencesQueryKeyPrefix },
				(previousData) => {
					if (!previousData) {
						return previousData;
					}

					return {
						...previousData,
						matrix: {
							...previousData.matrix,
							[notificationType]: {
								...previousData.matrix[notificationType],
								[channel]: enabled,
							},
						},
					};
				},
			);

			return { previousPreferenceQueries };
		},
		onError: (_err, _variables, context) => {
			// Rollback on error
			for (const [queryKey, previousData] of context?.previousPreferenceQueries ?? []) {
				queryClient.setQueryData(queryKey, previousData);
			}
		},
		onSettled: () => {
			// Always refetch after error or success
			queryClient.invalidateQueries({
				queryKey: preferencesQueryKeyPrefix,
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
				queryKey: preferencesQueryKeyPrefix,
			});
		},
	});

	return {
		preferences: data?.preferences ?? [],
		matrix: data?.matrix ?? null,
		availableChannels: data?.availableChannels ?? DEFAULT_AVAILABLE_CHANNELS,
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
