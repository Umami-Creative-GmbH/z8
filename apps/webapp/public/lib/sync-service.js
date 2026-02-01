/**
 * Sync Service for Offline Clock Events
 *
 * This file runs in the service worker context.
 * Handles syncing queued events to the server.
 */

const TIME_ENTRIES_API = "/api/time-entries";
const MAX_RETRY_COUNT = 5;
const SYNC_TIMEOUT_MS = 30000; // 30 second timeout for sync requests

/**
 * Sync a single clock event to the server
 * @param {Object} event - The queued clock event
 * @returns {Promise<{success: boolean, serverId?: string, error?: string, isConflict?: boolean, statusCode?: number}>}
 */
async function syncEvent(event) {
	// Create AbortController for timeout
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

	try {
		const body = {
			type: event.type,
			timestamp: new Date(event.timestamp).toISOString(),
		};

		// Add optional fields
		if (event.notes) body.notes = event.notes;
		if (event.location) body.location = event.location;
		if (event.projectId) body.projectId = event.projectId;
		if (event.workCategoryId) body.workCategoryId = event.workCategoryId;

		const response = await fetch(new URL(TIME_ENTRIES_API, self.location.origin).href, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			credentials: "include", // Include cookies for auth
			signal: controller.signal,
		});

		if (response.ok) {
			const data = await response.json();
			return {
				success: true,
				serverId: data.entry?.id || data.id,
			};
		}

		// Handle specific error codes
		const errorData = await response.json().catch(() => ({}));
		const errorMessage = errorData.error || `HTTP ${response.status}`;

		// 409 Conflict - already clocked in/out
		if (response.status === 409) {
			return {
				success: false,
				error: errorMessage,
				isConflict: true,
				statusCode: 409,
			};
		}

		// 401 Unauthorized - session expired
		if (response.status === 401) {
			return {
				success: false,
				error: "Session expired. Please log in again.",
				isConflict: false,
				statusCode: 401,
			};
		}

		// 400 Bad Request - validation error
		if (response.status === 400) {
			return {
				success: false,
				error: errorMessage,
				isConflict: true, // Treat as conflict to remove from queue
				statusCode: 400,
			};
		}

		// Other errors - retry later
		return {
			success: false,
			error: errorMessage,
			isConflict: false,
			statusCode: response.status,
		};
	} catch (error) {
		// Network or timeout error - retry later
		clearTimeout(timeoutId);
		const isTimeout = error.name === "AbortError";
		console.error("[SyncService] Network error:", isTimeout ? "Request timeout" : error);
		return {
			success: false,
			error: isTimeout ? "Request timed out. Will retry when online." : "Network error. Will retry when online.",
			isConflict: false,
		};
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Process all pending events in the queue
 * @returns {Promise<{successCount: number, failureCount: number, conflicts: Array}>}
 */
async function processQueue() {
	const pending = await self.OfflineQueueDB.getPending();

	if (pending.length === 0) {
		console.log("[SyncService] No pending events to sync");
		return { successCount: 0, failureCount: 0, conflicts: [] };
	}

	console.log("[SyncService] Processing", pending.length, "pending events");

	let successCount = 0;
	let failureCount = 0;
	const conflicts = [];

	// Process events sequentially (order matters for clock in/out)
	for (const event of pending) {
		// Skip events that have exceeded max retries
		if (event.retryCount >= MAX_RETRY_COUNT) {
			console.warn("[SyncService] Skipping event", event.id, "- max retries exceeded");
			conflicts.push({
				eventId: event.id,
				error: "Max retry attempts exceeded",
			});
			// Remove from queue after max retries
			await self.OfflineQueueDB.remove(event.id);
			failureCount++;
			continue;
		}

		const result = await syncEvent(event);

		if (result.success) {
			await self.OfflineQueueDB.remove(event.id);
			successCount++;

			// Notify clients of success
			broadcastMessage({
				type: "SYNC_SUCCESS",
				eventId: event.id,
				serverId: result.serverId,
			});
		} else if (result.isConflict) {
			// Conflict or validation error - remove from queue, notify user
			await self.OfflineQueueDB.remove(event.id);
			failureCount++;
			conflicts.push({
				eventId: event.id,
				error: result.error,
			});

			// Notify clients of conflict
			broadcastMessage({
				type: "SYNC_CONFLICT",
				eventId: event.id,
				error: result.error,
			});
		} else if (result.statusCode === 401) {
			// Session expired - stop processing, notify user
			broadcastMessage({
				type: "SYNC_ERROR",
				eventId: event.id,
				error: result.error,
			});
			break;
		} else {
			// Transient error - increment retry count
			await self.OfflineQueueDB.incrementRetry(event.id);
			failureCount++;

			// Notify clients of error
			broadcastMessage({
				type: "SYNC_ERROR",
				eventId: event.id,
				error: result.error,
			});
		}
	}

	return { successCount, failureCount, conflicts };
}

/**
 * Broadcast a message to all connected clients
 * @param {Object} message
 */
async function broadcastMessage(message) {
	const clients = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});

	for (const client of clients) {
		client.postMessage(message);
	}
}

/**
 * Notify clients of queue count update
 */
async function notifyQueueUpdate() {
	const count = await self.OfflineQueueDB.getCount();
	broadcastMessage({
		type: "QUEUE_UPDATED",
		count,
	});
}

// Export for service worker
if (typeof self !== "undefined") {
	self.SyncService = {
		TIME_ENTRIES_API,
		syncEvent,
		processQueue,
		broadcastMessage,
		notifyQueueUpdate,
	};
}
