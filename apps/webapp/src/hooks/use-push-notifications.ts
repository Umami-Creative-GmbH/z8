"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;

	const [isSupported, setIsSupported] = useState(false);
	const [permission, setPermission] = useState<PushPermission>("default");
	const [isSubscribed, setIsSubscribed] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
	const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);

	// Check browser support and current state
	useEffect(() => {
		const checkSupport = async () => {
			try {
				// Check if push notifications are supported
				if (
					!("serviceWorker" in navigator) ||
					!("PushManager" in window) ||
					!("Notification" in window)
				) {
					setIsSupported(false);
					setPermission("unsupported");
					return;
				}

				const vapidResponse = await fetch("/api/notifications/push/vapid-key");
				if (!vapidResponse.ok) {
					setIsSupported(false);
					setPermission("unsupported");
					return;
				}

				const { publicKey } = await vapidResponse.json();
				if (!publicKey) {
					setIsSupported(false);
					setPermission("unsupported");
					return;
				}

				setIsSupported(true);
				setVapidPublicKey(publicKey);

				// Check current permission
				const currentPermission = Notification.permission;
				setPermission(currentPermission);

				// Register or get existing service worker
				const reg = await navigator.serviceWorker.register("/sw.js", {
					scope: "/",
				});
				setRegistration(reg);

				// Check if already subscribed
				const subscription = await reg.pushManager.getSubscription();
				setIsSubscribed(!!subscription);
			} catch (error) {
				console.error("Failed to initialize push notifications:", error);
				setIsSupported(false);
				setPermission("unsupported");
				onErrorRef.current?.(error as Error);
			} finally {
				setIsLoading(false);
			}
		};

		checkSupport();
	}, []);

	// Request notification permission
	const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
		if (!isSupported) {
			return "denied";
		}

		try {
			const result = await Notification.requestPermission();
			setPermission(result);
			return result;
		} catch (error) {
			console.error("Failed to request notification permission:", error);
			onError?.(error as Error);
			return "denied";
		}
	}, [isSupported, onError]);

	// Subscribe to push notifications
	const subscribe = useCallback(
		async (deviceName?: string): Promise<boolean> => {
			if (!isSupported || !registration || !vapidPublicKey) {
				return false;
			}

			setIsLoading(true);

			try {
				// Request permission if not granted
				let currentPermission = Notification.permission;
				if (currentPermission === "default") {
					currentPermission = await requestPermission();
				}

				if (currentPermission !== "granted") {
					setIsLoading(false);
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
					throw new Error("Failed to save subscription on server");
				}

				setIsSubscribed(true);
				onSubscribe?.();
				return true;
			} catch (error) {
				console.error("Failed to subscribe to push notifications:", error);
				onError?.(error as Error);
				return false;
			} finally {
				setIsLoading(false);
			}
		},
		[isSupported, registration, requestPermission, vapidPublicKey, onSubscribe, onError],
	);

	// Unsubscribe from push notifications
	const unsubscribe = useCallback(async (): Promise<boolean> => {
		if (!registration) {
			return false;
		}

		setIsLoading(true);

		try {
			const subscription = await registration.pushManager.getSubscription();

			if (subscription) {
				// Unsubscribe from browser
				await subscription.unsubscribe();

				// Remove from server
				await fetch("/api/notifications/push/unsubscribe", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						endpoint: subscription.endpoint,
					}),
				});
			}

			setIsSubscribed(false);
			onUnsubscribe?.();
			return true;
		} catch (error) {
			console.error("Failed to unsubscribe from push notifications:", error);
			onError?.(error as Error);
			return false;
		} finally {
			setIsLoading(false);
		}
	}, [registration, onUnsubscribe, onError]);

	return {
		isSupported,
		permission,
		isSubscribed,
		isLoading,
		subscribe,
		unsubscribe,
		requestPermission,
		registration,
	};
}
