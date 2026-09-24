/**
 * Service Worker for z8 Time App
 *
 * Handles:
 * - Push notifications
 * - Offline clock event queue with Background Sync
 * - App shell caching for offline access
 */

// Import offline queue modules
importScripts("/lib/offline-queue-db.js");
importScripts("/lib/sync-service.js");

// =============================================================================
// CACHE CONFIGURATION
// =============================================================================

/** Cache name for push notifications */
const PUSH_CACHE = "z8-push-v1";

/** Cache name for app shell */
const APP_SHELL_CACHE = "z8-app-shell-v1";

/** Reported to callers; readers without it may delete queued clock records */
const CLOCK_QUEUE_MODE = "preservation-only-v1";

/** Background sync tag */
const SYNC_TAG = "clock-sync";

// TIME_ENTRIES_API is exported from sync-service.js via self.SyncService.TIME_ENTRIES_API

/** App shell files to precache */
const APP_SHELL_FILES = [
	"/",
	"/android-chrome-192x192.png",
	"/android-chrome-512x512.png",
	"/favicon-32x32.png",
	"/favicon-16x16.png",
	"/apple-touch-icon.png",
];

// Track if update is available (for prompt-to-refresh)
let updateAvailable = false;
let hadActiveWorkerOnInstall = false;

// =============================================================================
// INSTALL EVENT
// =============================================================================

self.addEventListener("install", (event) => {
	console.log("[SW] Installing service worker");
	hadActiveWorkerOnInstall = Boolean(self.registration?.active);

	event.waitUntil(
		(async () => {
			// Cache app shell files
			const cache = await caches.open(APP_SHELL_CACHE);
			console.log("[SW] Caching app shell files");

			// Cache files individually to handle failures gracefully
			await Promise.all(
				APP_SHELL_FILES.map(async (file) => {
					try {
						await cache.add(file);
					} catch (error) {
						console.warn("[SW] Failed to cache:", file, error);
					}
				}),
			);

			// DO NOT skip waiting by default - prompt user to refresh
			// self.skipWaiting() will be called via message when user accepts update.
			// Exception: replace a pre-preservation worker at once, because it deletes
			// queued clock records while it stays active (#266).
			if (hadActiveWorkerOnInstall && !(await activeWorkerPreservesClockQueue())) {
				console.log("[SW] Replacing pre-preservation clock queue reader");
				await self.skipWaiting();
			}
		})(),
	);
});

/**
 * Ask the active worker for its clock queue mode. Old workers answer GET_VERSION
 * without one; no answer is treated as not preserving.
 */
function activeWorkerPreservesClockQueue() {
	const active = self.registration?.active;
	if (!active) return Promise.resolve(false);
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(() => resolve(false), 3000);
		channel.port1.onmessage = (event) => {
			clearTimeout(timer);
			resolve(event.data?.clockQueueMode === CLOCK_QUEUE_MODE);
		};
		active.postMessage({ type: "GET_VERSION" }, [channel.port2]);
	});
}

// =============================================================================
// ACTIVATE EVENT
// =============================================================================

self.addEventListener("activate", (event) => {
	console.log("[SW] Activating service worker");
	const notifyUpdate = shouldNotifyUpdateOnActivation();

	event.waitUntil(
		(async () => {
			// Clean up old caches (keep current push and app shell caches)
			const cacheNames = await caches.keys();
			await Promise.all(
				cacheNames.flatMap((name) => {
					if (
						!name.startsWith("z8-") ||
						name === PUSH_CACHE ||
						name === APP_SHELL_CACHE
					) {
						return [];
					}

					console.log("[SW] Deleting old cache:", name);
					return [caches.delete(name)];
				}),
			);

			// Preserve and classify legacy entries; activation never purges by age.
			try {
				await self.OfflineQueueDB.cleanOldEntries();
			} catch (error) {
				console.warn("[SW] Failed to clean old queue entries:", error);
			}

			// Take control of all pages immediately
			await self.clients.claim();

			// Notify clients of update
			if (notifyUpdate) {
				self.SyncService.broadcastMessage({ type: "SW_UPDATE_AVAILABLE" });
			}
		})(),
	);
});

// =============================================================================
// FETCH EVENT - App Shell Caching & Offline Queue
// =============================================================================

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	// Only handle same-origin requests
	if (url.origin !== self.location.origin) {
		return;
	}

	// Handle clock-in/out API calls
	if (
		url.pathname === self.SyncService.TIME_ENTRIES_API &&
		event.request.method === "POST"
	) {
		event.respondWith(handleTimeEntryRequest(event.request));
		return;
	}

	// Handle navigation requests (HTML pages) - network first, cache fallback
	if (event.request.mode === "navigate") {
		event.respondWith(handleNavigationRequest(event.request));
		return;
	}

	// Handle static assets - cache first, network fallback
	if (isStaticAsset(url.pathname)) {
		event.respondWith(handleStaticAssetRequest(event.request));
		return;
	}
});

/**
 * Handle POST /api/time-entries requests
 * Queue offline if network fails
 */
async function handleTimeEntryRequest(request) {
	// Clone request BEFORE any body reading - body streams can only be read once
	const clonedRequest = request.clone();

	try {
		// Try network first
		const response = await fetch(request);
		return response;
	} catch (error) {
		// Network failed - queue for later
		console.log("[SW] Network failed for time entry, queueing for sync");

		try {
			// Preserve exact bytes, including unsupported/malformed evidence. Neither
			// failure-time nor the current session establishes original event context.
			const rawBody = await clonedRequest.text();
			let body;
			try {
				body = JSON.parse(rawBody);
			} catch {
				body = {};
			}
			const eventId = await self.OfflineQueueDB.enqueue({
				...(body && typeof body === "object" ? body : {}),
				interceptedRequest: {
					rawBody,
					url: request.url,
					method: request.method,
				},
			});
			await notifyQueueUpdateSafely();

			// Return a synthetic response indicating queued status
			return new Response(
				JSON.stringify({
					queued: true,
					eventId,
					reviewRequired: true,
					commitment: "unknown",
					message:
						"Saved on this device for review. Server commitment is unknown; do not submit replacement work before checking.",
				}),
				{
					status: 202, // Accepted
					headers: { "Content-Type": "application/json" },
				},
			);
		} catch (queueError) {
			console.error("[SW] Failed to queue time entry:", queueError);
			return new Response(
				JSON.stringify({
					error:
						"Could not save recovery evidence on this device. The server may have received the request; check before retrying.",
					queued: false,
					commitment: "unknown",
				}),
				{
					status: 500,
					headers: { "Content-Type": "application/json" },
				},
			);
		}
	}
}

/**
 * Handle navigation requests (HTML pages)
 * Network first, cache fallback
 */
async function handleNavigationRequest(request) {
	try {
		// Try network first
		const response = await fetch(request);

		// Cache successful responses
		if (response.ok) {
			const cache = await caches.open(APP_SHELL_CACHE);
			cache.put(request, response.clone());
		}

		return response;
	} catch (error) {
		// Network failed - try cache
		const cached = await caches.match(request);
		if (cached) {
			console.log("[SW] Serving cached page:", request.url);
			return cached;
		}

		// No cache - try root page as fallback (SPA)
		const rootCached = await caches.match("/");
		if (rootCached) {
			console.log("[SW] Serving cached root as fallback");
			return rootCached;
		}

		// Nothing cached - return offline error
		return new Response("Offline - no cached content available", {
			status: 503,
			headers: { "Content-Type": "text/plain" },
		});
	}
}

/**
 * Handle static asset requests
 * Cache first, network fallback
 */
async function handleStaticAssetRequest(request) {
	// Try cache first
	const cached = await caches.match(request);
	if (cached) {
		return cached;
	}

	// Not in cache - fetch and cache
	try {
		const response = await fetch(request);

		if (response.ok) {
			const cache = await caches.open(APP_SHELL_CACHE);
			cache.put(request, response.clone());
		}

		return response;
	} catch (error) {
		console.warn("[SW] Failed to fetch static asset:", request.url);
		return new Response("Asset not available offline", {
			status: 503,
			headers: { "Content-Type": "text/plain" },
		});
	}
}

/**
 * Check if a path is a static asset
 */
function isStaticAsset(pathname) {
	if (pathname.startsWith("/_next/")) {
		return false;
	}

	return !!pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|css|js)$/);
}

function shouldNotifyUpdateOnActivation() {
	return hadActiveWorkerOnInstall;
}

function getSafeNotificationUrl(urlToOpen) {
	try {
		const url = new URL(urlToOpen || "/", self.location.origin);
		if (url.origin !== self.location.origin) {
			return new URL("/", self.location.origin).href;
		}
		return url.href;
	} catch (_error) {
		return new URL("/", self.location.origin).href;
	}
}

// =============================================================================
// BACKGROUND SYNC EVENT
// =============================================================================

self.addEventListener("sync", (event) => {
	console.log("[SW] Sync event:", event.tag);

	if (event.tag === SYNC_TAG) {
		event.waitUntil(handleClockSync());
	}
});

/**
 * Process the offline queue when sync fires
 */
async function handleClockSync() {
	await broadcastSafely({ type: "SYNC_STARTED" });
	try {
		const result = await self.SyncService.processQueue();
		await notifyQueueUpdateSafely();
		return result;
	} catch (error) {
		await broadcastSafely({
			type: "SYNC_ERROR",
			error:
				"Clock recovery storage could not be updated. Records have not been acknowledged.",
		});
		// Reject waitUntil so the browser can retry storage failures. Review-held
		// records are not transient failures and must not enter a background loop.
		throw error;
	} finally {
		await broadcastSafely({ type: "SYNC_COMPLETED" });
	}
}

async function broadcastSafely(message) {
	try {
		await self.SyncService.broadcastMessage(message);
	} catch (error) {
		console.warn("[SW] Client notification unavailable:", error);
	}
}

async function notifyQueueUpdateSafely() {
	try {
		await self.SyncService.notifyQueueUpdate();
	} catch (error) {
		console.warn("[SW] Queue saved; status notification unavailable:", error);
	}
}

// =============================================================================
// MESSAGE EVENT - Client Communication
// =============================================================================

self.addEventListener("message", (event) => {
	const { type, payload } = event.data || {};

	switch (type) {
		case "SKIP_WAITING":
			console.log("[SW] Skip waiting requested");
			self.skipWaiting();
			break;

		case "GET_VERSION":
			event.ports[0]?.postMessage({
				version: APP_SHELL_CACHE,
				pushVersion: PUSH_CACHE,
				clockQueueMode: CLOCK_QUEUE_MODE,
			});
			break;

		case "QUEUE_CLOCK_EVENT":
			event.waitUntil(handleQueueClockEvent(payload, event));
			break;

		case "GET_QUEUE_COUNT":
			event.waitUntil(handleGetQueueCount(event));
			break;

		case "TRIGGER_SYNC":
			event.waitUntil(handleTriggerSync(event));
			break;

		case "GET_QUEUE_RECORDS":
		case "ARCHIVE_QUEUE_RECORD":
			event.waitUntil(handleRecoveryMessage(event));
			break;

		case "CLEAR_OLD_QUEUE":
			event.waitUntil(handleClearOldQueue(event));
			break;

		default:
			break;
	}
});

/**
 * Handle QUEUE_CLOCK_EVENT message
 */
async function handleQueueClockEvent(payload, event) {
	try {
		const eventId = await self.OfflineQueueDB.enqueue(payload);
		// Durable local acceptance precedes best-effort status notification.
		event.ports[0]?.postMessage({
			success: true,
			eventId,
			reviewRequired: true,
			commitment: "unknown",
		});
		await notifyQueueUpdateSafely();
	} catch (error) {
		console.error("[SW] Failed to queue event:", error);
		event.ports[0]?.postMessage({ success: false, error: error.message });
	}
}

/**
 * Handle GET_QUEUE_COUNT message
 */
async function handleGetQueueCount(event) {
	try {
		const context = await requireRecoveryContext(event.data.context);
		const records = (await self.OfflineQueueDB.getRecords()).filter((record) =>
			self.OfflineQueueDB.canInspect(record, context),
		);
		const count = records.filter(
			(record) => record.recovery?.state !== "archived",
		).length;
		event.ports[0]?.postMessage({
			count,
			reviewCount: count,
			savedCount: records.length,
		});
	} catch (error) {
		console.error("[SW] Failed to get queue count:", error);
		event.ports[0]?.postMessage({ count: 0, error: error.message });
	}
}

/**
 * Handle TRIGGER_SYNC message (manual sync)
 */
async function handleTriggerSync(event) {
	// Acknowledge start immediately (processing may exceed the client timeout).
	// Completion/error are separate notifications and durable status is reread.
	event.ports[0]?.postMessage({ success: true, accepted: true });
	try {
		await handleClockSync();
	} catch (error) {
		if ("sync" in self.registration) {
			try {
				await self.registration.sync.register(SYNC_TAG);
			} catch {
				// The visible error remains; explicit retry works without Background Sync.
			}
		}
	}
}

async function requireRecoveryContext(expected) {
	const response = await fetch(
		new URL("/api/time-entries/offline-context", self.location.origin),
		{
			credentials: "include",
			cache: "no-store",
			signal: AbortSignal.timeout(8000),
		},
	);
	if (!response.ok)
		throw new Error(
			"Sign in with an authorized organization to review saved clock records.",
		);
	const context = await response.json();
	if (
		!context.userId ||
		!context.organizationId ||
		(expected &&
			(expected.userId !== context.userId ||
				expected.organizationId !== context.organizationId))
	) {
		throw new Error(
			"Account or organization changed. Restore the captured context to review records.",
		);
	}
	return { ...context, serverOrigin: self.location.origin };
}

async function handleRecoveryMessage(event) {
	try {
		const context = await requireRecoveryContext(event.data.context);
		if (event.data.type === "ARCHIVE_QUEUE_RECORD") {
			await self.OfflineQueueDB.archive(event.data.eventId, context);
			await notifyQueueUpdateSafely();
		}
		const records = (await self.OfflineQueueDB.getRecords()).filter((record) =>
			self.OfflineQueueDB.canInspect(record, context),
		);
		event.ports[0]?.postMessage({ success: true, records });
	} catch (error) {
		event.ports[0]?.postMessage({ success: false, error: error.message });
	}
}

/**
 * Handle CLEAR_OLD_QUEUE message
 */
async function handleClearOldQueue(event) {
	try {
		const removedCount = await self.OfflineQueueDB.cleanOldEntries();
		await self.SyncService.notifyQueueUpdate();
		event.ports[0]?.postMessage({ success: true, removedCount });
	} catch (error) {
		console.error("[SW] Failed to clear old queue:", error);
		event.ports[0]?.postMessage({ success: false, error: error.message });
	}
}

// =============================================================================
// PUSH NOTIFICATION EVENTS (existing functionality)
// =============================================================================

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
		const response = await fetch(
			new URL("/api/wellness/water-action", self.location.origin).href,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					action: actionType === "log_water" ? "log" : "snooze",
					amount: 1,
				}),
				credentials: "include",
			},
		);

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
	if (
		data.type === "water_reminder" &&
		(action === "log_water" || action === "snooze_water")
	) {
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

	urlToOpen = getSafeNotificationUrl(urlToOpen);

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
