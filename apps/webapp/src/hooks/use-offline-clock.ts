"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useOnlineStatus } from "./use-online-status";
import type {
	ClientToSWMessage,
	OfflineQueueStatus,
	QueuedClockEvent,
	SWToClientMessage,
} from "@/lib/offline/types";

/**
 * Send a message to the service worker and wait for response
 */
async function sendMessageToSW<T>(message: ClientToSWMessage): Promise<T> {
	const registration = await navigator.serviceWorker.ready;
	const controller = registration.active;

	if (!controller) {
		throw new Error("No active service worker");
	}

	return new Promise((resolve, reject) => {
		const channel = new MessageChannel();
		let timeoutId: ReturnType<typeof setTimeout>;

		const cleanup = () => {
			clearTimeout(timeoutId);
			channel.port1.close();
		};

		channel.port1.onmessage = (event) => {
			cleanup();
			if (event.data.error) {
				reject(new Error(event.data.error));
			} else {
				resolve(event.data);
			}
		};

		controller.postMessage(message, [channel.port2]);

		// Timeout after 10 seconds
		timeoutId = setTimeout(() => {
			cleanup();
			reject(new Error("Service worker message timeout"));
		}, 10000);
	});
}

/**
 * Hook for managing offline clock events
 *
 * Provides:
 * - Queue count for pending events
 * - Online/offline status
 * - Sync status (syncing, error)
 * - Manual sync trigger
 */
export function useOfflineClock() {
	const isOnline = useOnlineStatus();
	const [pendingCount, setPendingCount] = useState(0);
	const [isSyncing, setIsSyncing] = useState(false);
	const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
	const [lastError, setLastError] = useState<string | null>(null);
	const [swReady, setSwReady] = useState(false);

	// Track if we've shown the "back online" toast
	const shownBackOnlineToast = useRef(false);

	// Initialize SW connection and listen for messages
	useEffect(() => {
		if (!("serviceWorker" in navigator)) {
			console.warn("[OfflineClock] Service workers not supported");
			return;
		}

		let mounted = true;

		// Wait for SW to be ready
		navigator.serviceWorker.ready.then(async (registration) => {
			if (!mounted) return;

			setSwReady(true);

			// Get initial queue count
			try {
				const response = await sendMessageToSW<{ count: number }>({
					type: "GET_QUEUE_COUNT",
				});
				if (mounted) {
					setPendingCount(response.count);
				}
			} catch (error) {
				console.warn("[OfflineClock] Failed to get initial queue count:", error);
			}
		});

		// Listen for messages from SW
		const handleMessage = (event: MessageEvent<SWToClientMessage>) => {
			if (!mounted) return;

			const { type } = event.data;

			switch (type) {
				case "QUEUE_UPDATED":
					setPendingCount(event.data.count);
					break;

				case "SYNC_STARTED":
					setIsSyncing(true);
					setLastError(null);
					break;

				case "SYNC_COMPLETED":
					setIsSyncing(false);
					setLastSyncAt(new Date());
					if (event.data.successCount > 0) {
						toast.success(
							`Synced ${event.data.successCount} clock event${event.data.successCount > 1 ? "s" : ""}`,
						);
					}
					break;

				case "SYNC_SUCCESS":
					// Individual event synced - no need to toast each one
					break;

				case "SYNC_CONFLICT":
					setLastError(event.data.error);
					toast.error("Clock event conflict", {
						description: event.data.error,
					});
					break;

				case "SYNC_ERROR":
					setLastError(event.data.error);
					// Don't toast every error - might be noisy
					break;

				case "SW_UPDATE_AVAILABLE":
					// Handled by SWUpdatePrompt component
					break;
			}
		};

		navigator.serviceWorker.addEventListener("message", handleMessage);

		return () => {
			mounted = false;
			navigator.serviceWorker.removeEventListener("message", handleMessage);
		};
	}, []);

	// Show "back online" notification when recovering
	useEffect(() => {
		if (isOnline && pendingCount > 0 && !shownBackOnlineToast.current) {
			shownBackOnlineToast.current = true;
			toast.info(`You're back online. Syncing ${pendingCount} pending event${pendingCount > 1 ? "s" : ""}...`);
		}

		if (!isOnline) {
			shownBackOnlineToast.current = false;
		}
	}, [isOnline, pendingCount]);

	/**
	 * Queue a clock event for offline sync
	 */
	const queueClockEvent = useCallback(
		async (
			event: Omit<QueuedClockEvent, "id" | "retryCount" | "createdAt">,
		): Promise<{ success: boolean; eventId?: string; error?: string }> => {
			if (!swReady) {
				return { success: false, error: "Service worker not ready" };
			}

			try {
				const response = await sendMessageToSW<{ success: boolean; eventId?: string }>({
					type: "QUEUE_CLOCK_EVENT",
					payload: event,
				});

				// Note: Caller (useTimeClock) shows the appropriate toast
				return response;
			} catch (error) {
				console.error("[OfflineClock] Failed to queue event:", error);
				return {
					success: false,
					error: error instanceof Error ? error.message : "Unknown error",
				};
			}
		},
		[swReady],
	);

	/**
	 * Trigger manual sync
	 */
	const triggerSync = useCallback(async (): Promise<void> => {
		if (!swReady || !isOnline) {
			return;
		}

		try {
			await sendMessageToSW({ type: "TRIGGER_SYNC" });
		} catch (error) {
			console.error("[OfflineClock] Failed to trigger sync:", error);
			setLastError(error instanceof Error ? error.message : "Sync failed");
		}
	}, [swReady, isOnline]);

	/**
	 * Clear old queue entries (> 7 days)
	 */
	const clearOldQueue = useCallback(async (): Promise<number> => {
		if (!swReady) {
			return 0;
		}

		try {
			const response = await sendMessageToSW<{ success: boolean; removedCount: number }>({
				type: "CLEAR_OLD_QUEUE",
			});
			return response.removedCount;
		} catch (error) {
			console.error("[OfflineClock] Failed to clear old queue:", error);
			return 0;
		}
	}, [swReady]);

	const status: OfflineQueueStatus = {
		pendingCount,
		isSyncing,
		lastSyncAt: lastSyncAt?.getTime() ?? null,
		lastError,
	};

	return {
		// Status
		isOnline,
		isOffline: !isOnline,
		pendingCount,
		isSyncing,
		lastSyncAt,
		lastError,
		status,
		swReady,

		// Actions
		queueClockEvent,
		triggerSync,
		clearOldQueue,
	};
}
