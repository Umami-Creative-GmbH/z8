"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchApi } from "@/lib/fetch";
import type { NotificationsListResponse, UnreadCountResponse } from "@/lib/notifications/types";
import { queryKeys } from "@/lib/query/keys";

interface UseNotificationsOptions {
	limit?: number;
	unreadOnly?: boolean;
	enabled?: boolean;
}

/**
 * Hook for managing notifications
 *
 * Provides:
 * - Notifications list query with pagination
 * - Unread count query
 * - Mark as read mutations
 * - Delete mutation
 */
export function useNotifications(options: UseNotificationsOptions = {}) {
	const { limit = 20, unreadOnly = false, enabled = true } = options;
	const queryClient = useQueryClient();

	// Query for notifications list
	const notificationsQuery = useQuery({
		queryKey: queryKeys.notifications.list({ unreadOnly }),
		queryFn: async (): Promise<NotificationsListResponse> => {
			const params = new URLSearchParams({
				limit: limit.toString(),
				unreadOnly: unreadOnly.toString(),
			});
			return fetchApi<NotificationsListResponse>(`/api/notifications?${params}`);
		},
		enabled,
		staleTime: 30 * 1000, // 30 seconds
		refetchOnWindowFocus: true,
	});

	// Query for unread count (separate for badge updates)
	// Note: Real-time updates come via SSE (useNotificationStream hook)
	const unreadCountQuery = useQuery({
		queryKey: queryKeys.notifications.unreadCount(),
		queryFn: async (): Promise<UnreadCountResponse> => {
			return fetchApi<UnreadCountResponse>("/api/notifications/count");
		},
		enabled,
		staleTime: 30 * 1000, // 30 seconds - SSE handles real-time updates
		refetchOnWindowFocus: true,
	});

	// Mark single notification as read
	const markAsReadMutation = useMutation({
		mutationFn: async (notificationId: string) => {
			return fetchApi("/api/notifications", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: notificationId }),
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
	});

	// Mark all notifications as read
	const markAllAsReadMutation = useMutation({
		mutationFn: async () => {
			return fetchApi("/api/notifications", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ markAllRead: true }),
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
	});

	// Delete notification
	const deleteMutation = useMutation({
		mutationFn: async (notificationId: string) => {
			return fetchApi("/api/notifications", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: notificationId }),
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
	});

	// Refresh all notification data
	const refresh = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
	}, [queryClient]);

	return {
		// List data
		notifications: notificationsQuery.data?.notifications ?? [],
		total: notificationsQuery.data?.total ?? 0,
		hasMore: notificationsQuery.data?.hasMore ?? false,
		isLoading: notificationsQuery.isLoading,
		isFetching: notificationsQuery.isFetching,
		isError: notificationsQuery.isError,

		// Unread count
		unreadCount: unreadCountQuery.data?.count ?? 0,
		isLoadingCount: unreadCountQuery.isLoading,

		// Actions
		markAsRead: markAsReadMutation.mutateAsync,
		markAllAsRead: markAllAsReadMutation.mutateAsync,
		deleteNotification: deleteMutation.mutateAsync,
		isMarkingRead: markAsReadMutation.isPending,
		isMarkingAllRead: markAllAsReadMutation.isPending,
		isDeleting: deleteMutation.isPending,

		// Utilities
		refresh,
	};
}
