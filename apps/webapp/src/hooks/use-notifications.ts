"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { fetchApi } from "@/lib/fetch";
import {
	NOTIFICATION_ORGANIZATION_HEADER,
	NOTIFICATION_SCOPE_CHANGED,
	NOTIFICATION_USER_HEADER,
} from "@/lib/notifications/request-scope";
import type {
	NotificationsListResponse,
	UnreadCountResponse,
} from "@/lib/notifications/types";
import { queryKeys } from "@/lib/query/keys";

const NOTIFICATION_POLL_INTERVAL_MS = 20 * 60 * 1000;

interface UseNotificationsOptions {
	limit?: number;
	unreadOnly?: boolean;
	organizationId?: string | null;
	enabled?: boolean;
}

function useNotificationScope(organizationId: string | null | undefined) {
	const { data: session, isPending } = useSession();
	const userId = session?.user.id ?? null;
	return {
		userId,
		isPending,
		organizationId: organizationId ?? null,
		matchesSession: Boolean(
			!isPending &&
				userId &&
				organizationId &&
				session?.session.activeOrganizationId === organizationId,
		),
	};
}

type NotificationScope = ReturnType<typeof useNotificationScope>;

function notificationRequestHeaders(
	scope: NotificationScope,
): Record<string, string> {
	if (!scope.matchesSession || !scope.userId || !scope.organizationId) {
		throw new Error(NOTIFICATION_SCOPE_CHANGED);
	}
	return {
		[NOTIFICATION_USER_HEADER]: scope.userId,
		[NOTIFICATION_ORGANIZATION_HEADER]: scope.organizationId,
	};
}

function useUnreadCountQuery(scope: NotificationScope, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.notifications.unreadCount(
			scope.organizationId,
			scope.userId,
		),
		queryFn: () =>
			fetchApi<UnreadCountResponse>("/api/notifications/count", {
				headers: notificationRequestHeaders(scope),
			}),
		enabled: enabled && scope.matchesSession,
		staleTime: NOTIFICATION_POLL_INTERVAL_MS,
		refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
		refetchOnWindowFocus: "always",
	});
}

/** The closed bell owns only its unread count; opening the inbox opts into its list. */
export function useNotificationUnreadCount({
	organizationId,
	enabled = true,
}: Pick<UseNotificationsOptions, "organizationId" | "enabled"> = {}) {
	const scope = useNotificationScope(organizationId);
	const query = useUnreadCountQuery(scope, enabled);
	return {
		unreadCount: scope.matchesSession ? (query.data?.count ?? 0) : 0,
		isLoadingCount: enabled && (scope.isPending || query.isLoading),
	};
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
	const {
		limit = 20,
		unreadOnly = false,
		organizationId,
		enabled = true,
	} = options;
	const queryClient = useQueryClient();
	const scope = useNotificationScope(organizationId);
	const listOptions = {
		limit,
		unreadOnly,
		organizationId: scope.organizationId,
		userId: scope.userId,
	};
	const invalidateInbox = (affectedScope: NotificationScope) =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.notifications.inbox(
				affectedScope.userId,
				affectedScope.organizationId,
			),
		});

	// Query for notifications list
	const notificationsQuery = useQuery({
		queryKey: queryKeys.notifications.list(listOptions),
		queryFn: async (): Promise<NotificationsListResponse> => {
			const params = new URLSearchParams({
				limit: limit.toString(),
				unreadOnly: unreadOnly.toString(),
			});
			return fetchApi<NotificationsListResponse>(
				`/api/notifications?${params}`,
				{ headers: notificationRequestHeaders(scope) },
			);
		},
		enabled: enabled && scope.matchesSession,
		staleTime: NOTIFICATION_POLL_INTERVAL_MS,
		refetchInterval: NOTIFICATION_POLL_INTERVAL_MS,
		refetchOnWindowFocus: "always",
	});

	// Query for unread count (separate for badge updates)
	const unreadCountQuery = useUnreadCountQuery(scope, enabled);

	// Mark single notification as read
	const markAsReadMutation = useMutation({
		mutationFn: async ({
			notificationId,
			scope,
		}: {
			notificationId: string;
			scope: NotificationScope;
		}) => {
			return fetchApi("/api/notifications", {
				method: "PATCH",
				headers: {
					...notificationRequestHeaders(scope),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ id: notificationId }),
			});
		},
		onSuccess: (_data, variables) => {
			return invalidateInbox(variables.scope);
		},
	});

	// Mark all notifications as read
	const markAllAsReadMutation = useMutation({
		mutationFn: async ({ scope }: { scope: NotificationScope }) => {
			return fetchApi("/api/notifications", {
				method: "PATCH",
				headers: {
					...notificationRequestHeaders(scope),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ markAllRead: true }),
			});
		},
		onSuccess: (_data, variables) => {
			return invalidateInbox(variables.scope);
		},
	});

	// Delete notification
	const deleteMutation = useMutation({
		mutationFn: async ({
			notificationId,
			scope,
		}: {
			notificationId: string;
			scope: NotificationScope;
		}) => {
			return fetchApi("/api/notifications", {
				method: "DELETE",
				headers: {
					...notificationRequestHeaders(scope),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ id: notificationId }),
			});
		},
		onSuccess: (_data, variables) => {
			return invalidateInbox(variables.scope);
		},
	});

	// Delete all notifications
	const deleteAllMutation = useMutation({
		mutationFn: async ({ scope }: { scope: NotificationScope }) => {
			return fetchApi("/api/notifications", {
				method: "DELETE",
				headers: {
					...notificationRequestHeaders(scope),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ deleteAll: true }),
			});
		},
		onSuccess: (_data, variables) => {
			return invalidateInbox(variables.scope);
		},
	});

	// Refresh all notification data
	const refresh = () => invalidateInbox(scope);

	return {
		// List data
		notifications: scope.matchesSession
			? (notificationsQuery.data?.notifications ?? [])
			: [],
		total: scope.matchesSession ? (notificationsQuery.data?.total ?? 0) : 0,
		hasMore:
			scope.matchesSession && (notificationsQuery.data?.hasMore ?? false),
		isLoading: enabled && (scope.isPending || notificationsQuery.isLoading),
		isFetching: notificationsQuery.isFetching,
		isError: scope.matchesSession && notificationsQuery.isError,

		// Unread count
		unreadCount: scope.matchesSession ? (unreadCountQuery.data?.count ?? 0) : 0,
		isLoadingCount: enabled && (scope.isPending || unreadCountQuery.isLoading),

		// Actions
		markAsRead: (notificationId: string) =>
			markAsReadMutation.mutateAsync({ notificationId, scope }),
		markAllAsRead: () => markAllAsReadMutation.mutateAsync({ scope }),
		deleteNotification: (notificationId: string) =>
			deleteMutation.mutateAsync({ notificationId, scope }),
		deleteAllNotifications: () => deleteAllMutation.mutateAsync({ scope }),
		isMarkingRead: markAsReadMutation.isPending,
		isMarkingAllRead: markAllAsReadMutation.isPending,
		isDeleting: deleteMutation.isPending,
		isDeletingAll: deleteAllMutation.isPending,

		// Utilities
		refresh,
	};
}
