/**
 * Service Worker for Push Notifications
 *
 * Handles:
 * - Push events from the server
 * - Displaying browser notifications
 * - Notification click actions (open app to specific URL)
 */

// Cache name for offline support (optional)
const CACHE_NAME = "z8-push-v1";

// Install event - set up the service worker
self.addEventListener("install", (event) => {
	// Skip waiting to activate immediately
	self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames
					.filter((name) => name.startsWith("z8-") && name !== CACHE_NAME)
					.map((name) => caches.delete(name)),
			);
		}),
	);
	// Take control of all pages immediately
	self.clients.claim();
});

// Push event - receive push notification from server
self.addEventListener("push", (event) => {
	if (!event.data) {
		console.warn("Push event received but no data");
		return;
	}

	let data;
	try {
		data = event.data.json();
	} catch (e) {
		console.error("Failed to parse push data:", e);
		return;
	}

	const {
		title = "z8 Notification",
		body = "",
		icon = "/android-chrome-192x192.png",
		badge = "/favicon-32x32.png",
		tag,
		data: notificationData = {},
	} = data;

	const options = {
		body,
		icon,
		badge,
		tag: tag || `z8-${Date.now()}`,
		data: notificationData,
		// Vibration pattern: vibrate 200ms, pause 100ms, vibrate 200ms
		vibrate: [200, 100, 200],
		// Actions for the notification (if supported)
		actions: notificationData.actions || [],
		// Require interaction - notification stays until user interacts
		requireInteraction: notificationData.requireInteraction || false,
		// Renotify even if tag is the same
		renotify: true,
		// Silent mode (no sound/vibration)
		silent: notificationData.silent || false,
	};

	event.waitUntil(self.registration.showNotification(title, options));
});

// Handle water reminder actions via API
async function handleWaterReminderAction(actionType) {
	try {
		const response = await fetch(new URL("/api/wellness/water-action", self.location.origin).href, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				action: actionType === "log_water" ? "log" : "snooze",
				amount: 1,
			}),
			credentials: "include",
		});

		if (response.ok) {
			const result = await response.json();
			// Show feedback notification
			if (actionType === "log_water" && result.goalJustMet) {
				await self.registration.showNotification("Daily goal reached!", {
					body: "Keep up the great hydration habit!",
					icon: "/android-chrome-192x192.png",
					badge: "/favicon-32x32.png",
					tag: "water-goal-met",
					silent: true,
				});
			}
		}
	} catch (error) {
		console.error("Failed to process water reminder action:", error);
	}
}

// Notification click event - handle user clicking on notification
self.addEventListener("notificationclick", (event) => {
	const notification = event.notification;
	const data = notification.data || {};
	const action = event.action;

	// Close the notification
	notification.close();

	// Handle water reminder specific actions
	if (data.type === "water_reminder" && (action === "log_water" || action === "snooze_water")) {
		event.waitUntil(handleWaterReminderAction(action));
		return;
	}

	// Determine the URL to open
	let urlToOpen = data.actionUrl || data.url || "/";

	// Handle specific actions if defined
	if (action && data.actions) {
		const clickedAction = data.actions.find((a) => a.action === action);
		if (clickedAction && clickedAction.url) {
			urlToOpen = clickedAction.url;
		}
	}

	// Ensure URL is absolute
	if (!urlToOpen.startsWith("http")) {
		urlToOpen = new URL(urlToOpen, self.location.origin).href;
	}

	event.waitUntil(
		// Try to focus an existing window with this URL, or open a new one
		clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((windowClients) => {
				// Check if there's already a window/tab open with the app
				for (const client of windowClients) {
					// If we find an existing window, focus it and navigate
					if (client.url.startsWith(self.location.origin)) {
						return client.focus().then((focusedClient) => {
							// Navigate to the action URL
							if (focusedClient && "navigate" in focusedClient) {
								return focusedClient.navigate(urlToOpen);
							}
						});
					}
				}
				// No existing window found, open a new one
				return clients.openWindow(urlToOpen);
			}),
	);
});

// Notification close event - track when user dismisses notification
self.addEventListener("notificationclose", (event) => {
	const notification = event.notification;
	const data = notification.data || {};

	// Optionally track notification dismissal
	if (data.notificationId) {
		// Could send analytics/tracking here
		console.log("Notification dismissed:", data.notificationId);
	}
});

// Handle messages from the main app
self.addEventListener("message", (event) => {
	const { type, payload } = event.data || {};

	switch (type) {
		case "SKIP_WAITING":
			self.skipWaiting();
			break;

		case "GET_VERSION":
			event.ports[0]?.postMessage({ version: CACHE_NAME });
			break;

		default:
			break;
	}
});
