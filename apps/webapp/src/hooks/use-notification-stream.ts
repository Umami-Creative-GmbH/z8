"use client";

import { useQueryClient } from "@tanstack/react-query";
import { startTransition, useEffect, useEffectEvent, useReducer, useRef } from "react";
import type {
	NotificationsListResponse,
	NotificationWithMeta,
	UnreadCountResponse,
} from "@/lib/notifications/types";
import { queryKeys } from "@/lib/query/keys";

interface UseNotificationStreamOptions {
	enabled?: boolean;
	organizationId?: string | null;
	onCountUpdate?: (count: number) => void;
	onNewNotification?: (notification: NotificationWithMeta) => void;
}

/**
 * Hook for real-time notification updates via SSE
 *
 * Connects to /api/notifications/stream and:
 * - Updates unread count in real-time
 * - Invalidates notification queries when count changes
 * - Handles reconnection on disconnect
 */
export function useNotificationStream(options: UseNotificationStreamOptions = {}) {
	const { enabled = true, organizationId, onCountUpdate, onNewNotification } = options;
	const queryClient = useQueryClient();
	const eventSourceRef = useRef<EventSource | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectAttempts = useRef(0);
	const reconnectRef = useRef<() => void>(() => {});
	const disconnectRef = useRef<() => void>(() => {});
	const [isConnected, dispatchConnectionStatus] = useReducer(
		(_current: boolean, next: boolean) => next,
		false,
	);

	// Store callbacks in refs to avoid dependency churn and prevent unnecessary reconnects
	const onCountUpdateRef = useRef(onCountUpdate);
	const onNewNotificationRef = useRef(onNewNotification);

	// Keep refs up to date
	useEffect(() => {
		onCountUpdateRef.current = onCountUpdate;
		onNewNotificationRef.current = onNewNotification;
	}, [onCountUpdate, onNewNotification]);

	const handleCountUpdate = useEffectEvent((event: MessageEvent) => {
		try {
			const data = JSON.parse(event.data);
			if (organizationId && data.organizationId !== organizationId) {
				return;
			}
			// Update the query cache directly
			queryClient.setQueryData(queryKeys.notifications.unreadCount(organizationId), {
				count: data.count,
			});
			onCountUpdateRef.current?.(data.count);
			// Reset reconnect attempts on successful message
			reconnectAttempts.current = 0;
		} catch {
			// Ignore parse errors
		}
	});

	const handleNewNotification = useEffectEvent((event: MessageEvent) => {
		try {
			const notification = JSON.parse(event.data) as NotificationWithMeta;
			if (organizationId && notification.organizationId !== organizationId) {
				return;
			}

			// Update every cached notification list, regardless of list options like limit.
			queryClient.setQueriesData<NotificationsListResponse>(
				{
					predicate: (query) => {
						const [scope, type, options] = query.queryKey;
						const listOptions = options as
							| { unreadOnly?: boolean; organizationId?: string | null }
							| undefined;
						if (scope !== "notifications" || type !== "list") {
							return false;
						}
						if (organizationId && listOptions?.organizationId !== organizationId) {
							return false;
						}

						return !notification.isRead || !listOptions?.unreadOnly;
					},
				},
				(oldData) => {
					if (!oldData) return oldData;
					if (oldData.notifications.some((n) => n.id === notification.id)) {
						return oldData;
					}

					return {
						...oldData,
						notifications: [notification, ...oldData.notifications],
						total: oldData.total + 1,
						unreadCount: notification.isRead ? oldData.unreadCount : oldData.unreadCount + 1,
					};
				},
			);

			if (!notification.isRead) {
				queryClient.setQueryData<UnreadCountResponse>(
					queryKeys.notifications.unreadCount(organizationId),
					(oldData) => ({ count: (oldData?.count ?? 0) + 1 }),
				);
			}

			onNewNotificationRef.current?.(notification);
			reconnectAttempts.current = 0;
		} catch {
			// Ignore parse errors
		}
	});

	const handleHeartbeat = useEffectEvent(() => {
		// Reset reconnect attempts on heartbeat
		reconnectAttempts.current = 0;
	});

	useEffect(() => {
		let disposed = false;

		const disconnect = () => {
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			if (eventSourceRef.current) {
				eventSourceRef.current.close();
				eventSourceRef.current = null;
			}
			dispatchConnectionStatus(false);
		};

		const connect = () => {
			// Only run in browser
			if (disposed || typeof window === "undefined" || typeof EventSource === "undefined") {
				return;
			}

			if (!enabled) return;

			// Clean up existing connection
			if (eventSourceRef.current) {
				eventSourceRef.current.close();
			}

			try {
				const eventSource = new EventSource("/api/notifications/stream");
				eventSourceRef.current = eventSource;

				eventSource.addEventListener("count_update", handleCountUpdate);
				eventSource.addEventListener("new_notification", handleNewNotification);
				eventSource.addEventListener("heartbeat", handleHeartbeat);

				eventSource.onerror = () => {
					if (disposed) return;
					eventSource.close();
					eventSourceRef.current = null;
					dispatchConnectionStatus(false);

					// Exponential backoff for reconnection
					reconnectAttempts.current += 1;
					const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);

					reconnectTimeoutRef.current = setTimeout(() => {
						connect();
					}, delay);
				};

				eventSource.onopen = () => {
					reconnectAttempts.current = 0;
					dispatchConnectionStatus(true);
				};
			} catch {
				// EventSource not supported or connection failed
				dispatchConnectionStatus(false);
			}
		};

		reconnectRef.current = connect;
		disconnectRef.current = disconnect;

		if (enabled) {
			startTransition(connect);
		}

		return () => {
			disposed = true;
			disconnect();
		};
	}, [enabled, handleCountUpdate, handleHeartbeat, handleNewNotification]);

	return {
		isConnected,
		reconnect: () => reconnectRef.current(),
		disconnect: () => disconnectRef.current(),
	};
}
