"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
import { queryKeys } from "@/lib/query/keys";

interface UseNotificationStreamOptions {
	enabled?: boolean;
	onCountUpdate?: (count: number) => void;
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
	const { enabled = true, onCountUpdate } = options;
	const queryClient = useQueryClient();
	const eventSourceRef = useRef<EventSource | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectAttempts = useRef(0);

	const connect = useCallback(() => {
		if (!enabled) return;

		// Clean up existing connection
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
		}

		try {
			const eventSource = new EventSource("/api/notifications/stream");
			eventSourceRef.current = eventSource;

			eventSource.addEventListener("count_update", (event) => {
				try {
					const data = JSON.parse(event.data);
					// Update the query cache directly
					queryClient.setQueryData(queryKeys.notifications.unreadCount(), {
						count: data.count,
					});
					onCountUpdate?.(data.count);
					// Reset reconnect attempts on successful message
					reconnectAttempts.current = 0;
				} catch {
					// Ignore parse errors
				}
			});

			eventSource.addEventListener("heartbeat", () => {
				// Reset reconnect attempts on heartbeat
				reconnectAttempts.current = 0;
			});

			eventSource.onerror = () => {
				eventSource.close();
				eventSourceRef.current = null;

				// Exponential backoff for reconnection
				reconnectAttempts.current += 1;
				const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);

				reconnectTimeoutRef.current = setTimeout(() => {
					if (enabled) {
						connect();
					}
				}, delay);
			};

			eventSource.onopen = () => {
				reconnectAttempts.current = 0;
			};
		} catch {
			// EventSource not supported or connection failed
		}
	}, [enabled, queryClient, onCountUpdate]);

	const disconnect = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
			eventSourceRef.current = null;
		}
	}, []);

	useEffect(() => {
		if (enabled) {
			connect();
		}

		return () => {
			disconnect();
		};
	}, [enabled, connect, disconnect]);

	return {
		isConnected: eventSourceRef.current?.readyState === EventSource.OPEN,
		reconnect: connect,
		disconnect,
	};
}
