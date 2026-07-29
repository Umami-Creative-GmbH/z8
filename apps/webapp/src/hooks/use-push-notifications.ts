"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
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
	error: Error | null;

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

let isBrowserPushActionInFlight = false;

function logCallbackError(error: unknown) {
	console.error("Push notification callback failed:", error);
}

function invokeCallback(callback: (() => unknown) | undefined) {
	try {
		const result = callback?.();
		if (result && typeof (result as PromiseLike<unknown>).then === "function") {
			void Promise.resolve(result).catch(logCallbackError);
		}
	} catch (error) {
		logCallbackError(error);
	}
}

async function loadPushBootstrap(
	signal: AbortSignal,
): Promise<PushBootstrapState> {
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
	const queryClient = useQueryClient();
	const [isActionPending, setIsActionPending] = useState(false);
	const callbacksRef = useRef({ onSubscribe, onUnsubscribe, onError });
	useLayoutEffect(() => {
		callbacksRef.current = { onSubscribe, onUnsubscribe, onError };
	}, [onSubscribe, onUnsubscribe, onError]);
	const bootstrapQuery = useQuery({
		queryKey: queryKeys.notifications.pushBootstrap(),
		queryFn: ({ signal }) => loadPushBootstrap(signal),
		staleTime: 60 * 1000,
		refetchOnWindowFocus: true,
		retry: false,
	});
	const bootstrap = bootstrapQuery.data ?? UNSUPPORTED_PUSH_STATE;
	const {
		isSupported,
		permission,
		isSubscribed,
		registration,
		vapidPublicKey,
	} = bootstrap;
	const error =
		bootstrapQuery.error instanceof Error ? bootstrapQuery.error : null;

	const updateBootstrap = (updates: Partial<PushBootstrapState>) => {
		queryClient.setQueryData<PushBootstrapState>(
			queryKeys.notifications.pushBootstrap(),
			(current) => (current ? { ...current, ...updates } : current),
		);
	};
	const reportError = (error: Error) => {
		const callback = callbacksRef.current.onError;
		invokeCallback(callback ? () => callback(error) : undefined);
	};

	const requestPermissionOperation = async (): Promise<{
		permission: NotificationPermission;
		error: Error | null;
	}> => {
		if (!isSupported) {
			return { permission: "denied", error: null };
		}

		try {
			const result = await Notification.requestPermission();
			updateBootstrap({ permission: result });
			return { permission: result, error: null };
		} catch (error) {
			console.error("Failed to request notification permission:", error);
			return { permission: "denied", error: error as Error };
		}
	};

	// Request notification permission
	const requestPermission = async (): Promise<NotificationPermission> => {
		const result = await requestPermissionOperation();
		if (result.error) {
			reportError(result.error);
		}
		return result.permission;
	};

	// Subscribe to push notifications
	const subscribe = async (deviceName?: string): Promise<boolean> => {
		if (!isSupported || !registration || !vapidPublicKey) {
			return false;
		}
		if (isBrowserPushActionInFlight) {
			return false;
		}

		isBrowserPushActionInFlight = true;
		setIsActionPending(true);
		let actionResult = false;
		let callbackError: Error | null = null;
		let shouldNotifySubscribe = false;
		try {
			let subscription: PushSubscription | null = null;
			let serverPersistenceSucceeded = false;
			const rollbackSubscription = async () => {
				const currentSubscription = subscription;
				if (!currentSubscription) return;

				try {
					await currentSubscription.unsubscribe();
					updateBootstrap({ isSubscribed: false });
				} catch {
					const activeSubscription = await registration.pushManager
						.getSubscription()
						.catch(() => currentSubscription);
					updateBootstrap({ isSubscribed: Boolean(activeSubscription) });
				}
			};

			try {
				// Request permission if not granted
				let currentPermission = Notification.permission;
				if (currentPermission === "default") {
					const permissionResult = await requestPermissionOperation();
					currentPermission = permissionResult.permission;
					callbackError = permissionResult.error;
				}

				if (currentPermission !== "granted") {
					actionResult = false;
				} else {
					// Subscribe to push manager
					subscription = await registration.pushManager.subscribe({
						userVisibleOnly: true,
						applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
					});

					// Send subscription to server
					const subscribeResponse = await fetch(
						"/api/notifications/push/subscribe",
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								subscription: subscription.toJSON(),
								deviceName,
							}),
						},
					);

					if (!subscribeResponse.ok) {
						await rollbackSubscription();
						callbackError = new Error("Failed to save subscription on server");
					} else {
						serverPersistenceSucceeded = true;
						updateBootstrap({
							isSubscribed: true,
							permission: currentPermission,
						});
						actionResult = true;
						shouldNotifySubscribe = true;
					}
				}
			} catch (error) {
				if (subscription && !serverPersistenceSucceeded) {
					await rollbackSubscription();
				}
				console.error("Failed to subscribe to push notifications:", error);
				callbackError = error as Error;
			}
		} catch (error) {
			console.error(
				"Unexpected failure while subscribing to push notifications:",
				error,
			);
			if (!callbackError) callbackError = error as Error;
		}
		isBrowserPushActionInFlight = false;
		setIsActionPending(false);

		if (callbackError) {
			reportError(callbackError);
		} else if (shouldNotifySubscribe) {
			invokeCallback(callbacksRef.current.onSubscribe);
		}
		return actionResult;
	};

	// Unsubscribe from push notifications
	const unsubscribe = async (): Promise<boolean> => {
		if (!registration) {
			return false;
		}
		if (isBrowserPushActionInFlight) {
			return false;
		}

		isBrowserPushActionInFlight = true;
		setIsActionPending(true);
		let actionResult = false;
		let callbackError: Error | null = null;
		let shouldNotifyUnsubscribe = false;

		try {
			try {
				const subscription = await registration.pushManager.getSubscription();

				if (subscription) {
					const unsubscribeResponse = await fetch(
						"/api/notifications/push/unsubscribe",
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								endpoint: subscription.endpoint,
							}),
						},
					);
					if (!unsubscribeResponse.ok) {
						const error = new Error(
							"Failed to remove subscription from server",
						);
						console.error(
							"Failed to unsubscribe from push notifications:",
							error,
						);
						callbackError = error;
					} else {
						await subscription.unsubscribe();
						updateBootstrap({ isSubscribed: false });
						actionResult = true;
						shouldNotifyUnsubscribe = true;
					}
				} else {
					updateBootstrap({ isSubscribed: false });
					actionResult = true;
					shouldNotifyUnsubscribe = true;
				}
			} catch (error) {
				console.error("Failed to unsubscribe from push notifications:", error);
				callbackError = error as Error;
			}
		} catch (error) {
			console.error(
				"Unexpected failure while unsubscribing from push notifications:",
				error,
			);
			if (!callbackError) callbackError = error as Error;
		}
		isBrowserPushActionInFlight = false;
		setIsActionPending(false);

		if (callbackError) {
			reportError(callbackError);
		} else if (shouldNotifyUnsubscribe) {
			invokeCallback(callbacksRef.current.onUnsubscribe);
		}
		return actionResult;
	};

	return {
		isSupported,
		permission,
		isSubscribed,
		isLoading: bootstrapQuery.isLoading || isActionPending,
		error,
		subscribe,
		unsubscribe,
		requestPermission,
		registration,
	};
}
