"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";
import { queryKeys } from "@/lib/query/keys";

type PushPermission = "default" | "granted" | "denied" | "unsupported";

interface UsePushNotificationsOptions {
	onSubscribe?: () => void;
	onUnsubscribe?: () => void;
	onError?: (error: Error) => void;
}

interface UsePushNotificationsResult {
	// Status
	isSupported: boolean;
	permission: PushPermission;
	isSubscribed: boolean;
	isLoading: boolean;

	// Actions
	subscribe: (deviceName?: string) => Promise<boolean>;
	unsubscribe: () => Promise<boolean>;
	requestPermission: () => Promise<NotificationPermission>;

	// Service worker
	registration: ServiceWorkerRegistration | null;
}

interface PushBootstrapState {
	isSupported: boolean;
	permission: PushPermission;
	isSubscribed: boolean;
	registration: ServiceWorkerRegistration | null;
	vapidPublicKey: string | null;
}

const UNSUPPORTED_PUSH_STATE: PushBootstrapState = {
	isSupported: false,
	permission: "unsupported",
	isSubscribed: false,
	registration: null,
	vapidPublicKey: null,
};

async function loadPushBootstrap(signal: AbortSignal): Promise<PushBootstrapState> {
	if (
		!("serviceWorker" in navigator) ||
		!("PushManager" in window) ||
		!("Notification" in window)
	) {
		return UNSUPPORTED_PUSH_STATE;
	}

	const vapidResponse = await fetch("/api/notifications/push/vapid-key", {
		signal,
	});
	if (!vapidResponse.ok) return UNSUPPORTED_PUSH_STATE;

	const { publicKey } = (await vapidResponse.json()) as { publicKey?: string };
	if (!publicKey) return UNSUPPORTED_PUSH_STATE;

	const registration = await navigator.serviceWorker.register("/sw.js", {
		scope: "/",
	});
	const subscription = await registration.pushManager.getSubscription();

	return {
		isSupported: true,
		permission: Notification.permission,
		isSubscribed: Boolean(subscription),
		registration,
		vapidPublicKey: publicKey,
	};
}

/**
 * Convert a base64 string to Uint8Array for applicationServerKey
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);

	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}

	return outputArray;
}

/**
 * Hook for managing push notifications
 *
 * Provides:
 * - Browser support detection
 * - Permission management
 * - Subscribe/unsubscribe functionality
 * - Service worker registration
 */
export function usePushNotifications(
	options: UsePushNotificationsOptions = {},
): UsePushNotificationsResult {
	const { onSubscribe, onUnsubscribe, onError } = options;
	const handleError = useEffectEvent((error: Error) => {
		onError?.(error);
	});
	const queryClient = useQueryClient();
	const [isActionPending, setIsActionPending] = useState(false);
	const bootstrapQuery = useQuery({
		queryKey: queryKeys.notifications.pushBootstrap(),
		queryFn: ({ signal }) => loadPushBootstrap(signal),
		staleTime: 60 * 1000,
		refetchOnWindowFocus: true,
		retry: false,
	});
	const bootstrap = bootstrapQuery.data ?? UNSUPPORTED_PUSH_STATE;
	const { isSupported, permission, isSubscribed, registration, vapidPublicKey } = bootstrap;

	useEffect(() => {
		if (bootstrapQuery.error instanceof Error) {
			handleError(bootstrapQuery.error);
		}
	}, [bootstrapQuery.error]);

	const updateBootstrap = (updates: Partial<PushBootstrapState>) => {
		queryClient.setQueryData<PushBootstrapState>(
			queryKeys.notifications.pushBootstrap(),
			(current) => (current ? { ...current, ...updates } : current),
		);
	};

	// Request notification permission
	const requestPermission = async (): Promise<NotificationPermission> => {
		if (!isSupported) {
			return "denied";
		}

		try {
			const result = await Notification.requestPermission();
			updateBootstrap({ permission: result });
			return result;
		} catch (error) {
			console.error("Failed to request notification permission:", error);
			onError?.(error as Error);
			return "denied";
		}
	};

	// Subscribe to push notifications
	const subscribe = async (deviceName?: string): Promise<boolean> => {
		if (!isSupported || !registration || !vapidPublicKey) {
			return false;
		}

		setIsActionPending(true);

		try {
			// Request permission if not granted
			let currentPermission = Notification.permission;
			if (currentPermission === "default") {
				currentPermission = await requestPermission();
			}

			if (currentPermission !== "granted") {
				setIsActionPending(false);
				return false;
			}

			// Subscribe to push manager
			const subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
			});

			// Send subscription to server
			const subscribeResponse = await fetch("/api/notifications/push/subscribe", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					subscription: subscription.toJSON(),
					deviceName,
				}),
			});

			if (!subscribeResponse.ok) {
				await subscription.unsubscribe().catch(() => false);
				setIsActionPending(false);
				onError?.(new Error("Failed to save subscription on server"));
				return false;
			}

			updateBootstrap({ isSubscribed: true, permission: currentPermission });
			setIsActionPending(false);
			onSubscribe?.();
			return true;
		} catch (error) {
			console.error("Failed to subscribe to push notifications:", error);
			setIsActionPending(false);
			onError?.(error as Error);
			return false;
		}
	};

	// Unsubscribe from push notifications
	const unsubscribe = async (): Promise<boolean> => {
		if (!registration) {
			return false;
		}

		setIsActionPending(true);

		try {
			const subscription = await registration.pushManager.getSubscription();

			if (subscription) {
				const unsubscribeResponse = await fetch("/api/notifications/push/unsubscribe", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						endpoint: subscription.endpoint,
					}),
				});
				if (!unsubscribeResponse.ok) {
					const error = new Error("Failed to remove subscription from server");
					console.error("Failed to unsubscribe from push notifications:", error);
					setIsActionPending(false);
					onError?.(error);
					return false;
				}
				if (!(await subscription.unsubscribe())) {
					const error = new Error("Failed to unsubscribe this browser");
					console.error("Failed to unsubscribe from push notifications:", error);
					setIsActionPending(false);
					onError?.(error);
					return false;
				}
			}

			updateBootstrap({ isSubscribed: false });
			setIsActionPending(false);
			onUnsubscribe?.();
			return true;
		} catch (error) {
			console.error("Failed to unsubscribe from push notifications:", error);
			setIsActionPending(false);
			onError?.(error as Error);
			return false;
		}
	};

	return {
		isSupported,
		permission,
		isSubscribed,
		isLoading: bootstrapQuery.isLoading || isActionPending,
		subscribe,
		unsubscribe,
		requestPermission,
		registration,
	};
}
