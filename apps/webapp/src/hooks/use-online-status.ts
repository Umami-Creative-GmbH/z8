"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Subscribe to online/offline status changes
 */
function subscribeToOnlineStatus(callback: () => void): () => void {
	window.addEventListener("online", callback);
	window.addEventListener("offline", callback);

	return () => {
		window.removeEventListener("online", callback);
		window.removeEventListener("offline", callback);
	};
}

/**
 * Get current online status (client-side)
 */
function getOnlineStatus(): boolean {
	return typeof navigator !== "undefined" ? navigator.onLine : true;
}

/**
 * Server snapshot - always return true for SSR
 */
function getServerSnapshot(): boolean {
	return true;
}

/**
 * Hook to track online/offline status
 *
 * Uses useSyncExternalStore for proper React 18 concurrent mode support.
 * Returns true if online, false if offline.
 */
export function useOnlineStatus(): boolean {
	const isOnline = useSyncExternalStore(subscribeToOnlineStatus, getOnlineStatus, getServerSnapshot);

	return isOnline;
}

/**
 * Hook that provides online status with additional utilities
 */
export function useNetworkStatus() {
	const isOnline = useOnlineStatus();
	const [wasOffline, setWasOffline] = useState(false);

	// Track if we recovered from offline state
	useEffect(() => {
		if (!isOnline) {
			setWasOffline(true);
		}
	}, [isOnline]);

	// Reset wasOffline after a delay when back online
	useEffect(() => {
		if (isOnline && wasOffline) {
			const timer = setTimeout(() => {
				setWasOffline(false);
			}, 3000);
			return () => clearTimeout(timer);
		}
	}, [isOnline, wasOffline]);

	return {
		isOnline,
		isOffline: !isOnline,
		/** True if we just recovered from being offline */
		justRecovered: isOnline && wasOffline,
	};
}
