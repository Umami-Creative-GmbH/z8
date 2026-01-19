"use client";

/**
 * Notification Stream Hook with Suspense Support
 *
 * Provides real-time notification updates via SSE with proper
 * Suspense boundaries to prevent blocking the UI.
 *
 * Rule: async-suspense-boundaries
 */

import * as React from "react";

export interface NotificationStreamState {
	unreadCount: number;
	isConnected: boolean;
	error: Error | null;
}

/**
 * Hook for subscribing to the notification SSE stream
 * Automatically reconnects on disconnect with exponential backoff
 */
export function useNotificationStream(
	options: { enabled?: boolean; onNewNotification?: (notification: unknown) => void } = {},
): NotificationStreamState {
	const { enabled = true, onNewNotification } = options;

	const [state, setState] = React.useState<NotificationStreamState>({
		unreadCount: 0,
		isConnected: false,
		error: null,
	});

	// Store callback in ref to avoid reconnection on callback change
	const onNewNotificationRef = React.useRef(onNewNotification);
	onNewNotificationRef.current = onNewNotification;

	React.useEffect(() => {
		if (!enabled) return;

		let eventSource: EventSource | null = null;
		let reconnectAttempts = 0;
		let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			eventSource = new EventSource("/api/notifications/stream");

			eventSource.onopen = () => {
				reconnectAttempts = 0;
				setState((prev) => ({ ...prev, isConnected: true, error: null }));
			};

			eventSource.onerror = () => {
				setState((prev) => ({
					...prev,
					isConnected: false,
					error: new Error("Connection lost"),
				}));

				// Exponential backoff for reconnection
				const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
				reconnectAttempts++;

				reconnectTimeout = setTimeout(() => {
					if (eventSource) {
						eventSource.close();
					}
					connect();
				}, delay);
			};

			// Handle count updates
			eventSource.addEventListener("count_update", (event) => {
				try {
					const data = JSON.parse(event.data);
					setState((prev) => ({ ...prev, unreadCount: data.count }));
				} catch {
					// Ignore parse errors
				}
			});

			// Handle new notifications
			eventSource.addEventListener("new_notification", (event) => {
				try {
					const data = JSON.parse(event.data);
					onNewNotificationRef.current?.(data);
					// Also increment count optimistically
					setState((prev) => ({
						...prev,
						unreadCount: prev.unreadCount + 1,
					}));
				} catch {
					// Ignore parse errors
				}
			});

			// Heartbeat keeps connection alive (no state update needed)
			eventSource.addEventListener("heartbeat", () => {
				// Connection is alive
			});
		};

		connect();

		return () => {
			if (reconnectTimeout) {
				clearTimeout(reconnectTimeout);
			}
			if (eventSource) {
				eventSource.close();
			}
		};
	}, [enabled]);

	return state;
}

/**
 * Suspense-enabled notification provider
 *
 * Wrap notification-dependent UI in this to prevent blocking:
 *
 * ```tsx
 * <Suspense fallback={<NotificationBadgeSkeleton />}>
 *   <NotificationStreamProvider>
 *     <NotificationBadge />
 *   </NotificationStreamProvider>
 * </Suspense>
 * ```
 */
const NotificationStreamContext = React.createContext<NotificationStreamState | null>(null);

export function NotificationStreamProvider({
	children,
	onNewNotification,
}: {
	children: React.ReactNode;
	onNewNotification?: (notification: unknown) => void;
}) {
	const stream = useNotificationStream({ onNewNotification });

	return (
		<NotificationStreamContext.Provider value={stream}>
			{children}
		</NotificationStreamContext.Provider>
	);
}

/**
 * Hook to consume notification stream from context
 * Must be used within NotificationStreamProvider
 */
export function useNotificationStreamContext(): NotificationStreamState {
	const context = React.useContext(NotificationStreamContext);
	if (!context) {
		throw new Error("useNotificationStreamContext must be used within NotificationStreamProvider");
	}
	return context;
}

/**
 * Notification badge skeleton for Suspense fallback
 */
export function NotificationBadgeSkeleton() {
	return (
		<div className="relative inline-flex">
			<div className="h-6 w-6 animate-pulse rounded-full bg-muted" />
		</div>
	);
}
