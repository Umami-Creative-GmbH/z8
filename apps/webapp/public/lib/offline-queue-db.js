/**
 * IndexedDB Repository for Offline Clock Event Queue
 *
 * This file runs in the service worker context.
 * Provides CRUD operations for queued clock events.
 */

const DB_NAME = "z8-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "clock-events";
const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Open the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => {
			console.error("[OfflineQueue] Failed to open database:", request.error);
			reject(request.error);
		};

		request.onsuccess = () => {
			resolve(request.result);
		};

		request.onupgradeneeded = (event) => {
			const db = event.target.result;

			// Create object store if it doesn't exist
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, {
					keyPath: "id",
				});

				// Index for cleanup queries (oldest first)
				store.createIndex("createdAt", "createdAt", { unique: false });

				// Index for organization isolation
				store.createIndex("organizationId", "organizationId", { unique: false });

				console.log("[OfflineQueue] Created object store:", STORE_NAME);
			}
		};
	});
}

/**
 * Generate a unique ID for queue entries
 * @returns {string}
 */
function generateId() {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Add a clock event to the offline queue
 * @param {Object} event - The clock event to queue
 * @param {string} event.type - "clock_in" or "clock_out"
 * @param {number} event.timestamp - When the user clicked clock in/out
 * @param {string} event.organizationId - Organization ID
 * @param {string} [event.notes] - Optional notes
 * @param {Object} [event.location] - Optional location
 * @param {string} [event.projectId] - Optional project ID
 * @param {string} [event.workCategoryId] - Optional work category ID
 * @returns {Promise<string>} The ID of the queued event
 */
async function enqueue(event) {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		const tx = db.transaction([STORE_NAME], "readwrite");
		const store = tx.objectStore(STORE_NAME);

		const queuedEvent = {
			id: generateId(),
			type: event.type,
			timestamp: event.timestamp,
			organizationId: event.organizationId,
			notes: event.notes,
			location: event.location,
			projectId: event.projectId,
			workCategoryId: event.workCategoryId,
			retryCount: 0,
			createdAt: Date.now(),
		};

		const request = store.add(queuedEvent);

		request.onerror = () => {
			console.error("[OfflineQueue] Failed to enqueue event:", request.error);
			reject(request.error);
		};

		request.onsuccess = () => {
			console.log("[OfflineQueue] Enqueued event:", queuedEvent.id, queuedEvent.type);
			resolve(queuedEvent.id);
		};

		// Ensure DB is closed on all paths
		tx.oncomplete = () => db.close();
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
	});
}

/**
 * Get all pending events in the queue (oldest first)
 * @returns {Promise<Array>}
 */
async function getPending() {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		const tx = db.transaction([STORE_NAME], "readonly");
		const store = tx.objectStore(STORE_NAME);
		const index = store.index("createdAt");

		const request = index.getAll();

		request.onerror = () => {
			console.error("[OfflineQueue] Failed to get pending events:", request.error);
			reject(request.error);
		};

		request.onsuccess = () => {
			resolve(request.result || []);
		};

		// Ensure DB is closed on all paths
		tx.oncomplete = () => db.close();
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
	});
}

/**
 * Get the count of pending events
 * @returns {Promise<number>}
 */
async function getCount() {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		const tx = db.transaction([STORE_NAME], "readonly");
		const store = tx.objectStore(STORE_NAME);

		const request = store.count();

		request.onerror = () => {
			console.error("[OfflineQueue] Failed to count events:", request.error);
			reject(request.error);
		};

		request.onsuccess = () => {
			resolve(request.result);
		};

		// Ensure DB is closed on all paths
		tx.oncomplete = () => db.close();
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
	});
}

/**
 * Remove an event from the queue (after successful sync)
 * @param {string} id - The event ID to remove
 * @returns {Promise<void>}
 */
async function remove(id) {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		const tx = db.transaction([STORE_NAME], "readwrite");
		const store = tx.objectStore(STORE_NAME);

		const request = store.delete(id);

		request.onerror = () => {
			console.error("[OfflineQueue] Failed to remove event:", request.error);
			reject(request.error);
		};

		request.onsuccess = () => {
			console.log("[OfflineQueue] Removed event:", id);
			resolve();
		};

		// Ensure DB is closed on all paths
		tx.oncomplete = () => db.close();
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
	});
}

/**
 * Increment the retry count for an event
 * @param {string} id - The event ID
 * @returns {Promise<void>}
 */
async function incrementRetry(id) {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		const tx = db.transaction([STORE_NAME], "readwrite");
		const store = tx.objectStore(STORE_NAME);

		const getRequest = store.get(id);

		getRequest.onerror = () => reject(getRequest.error);

		getRequest.onsuccess = () => {
			const event = getRequest.result;
			if (!event) {
				resolve();
				return;
			}

			event.retryCount = (event.retryCount || 0) + 1;

			const putRequest = store.put(event);

			putRequest.onerror = () => reject(putRequest.error);
			putRequest.onsuccess = () => {
				console.log("[OfflineQueue] Incremented retry for:", id, "count:", event.retryCount);
				resolve();
			};
		};

		// Ensure DB is closed on all paths
		tx.oncomplete = () => db.close();
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
	});
}

/**
 * Remove events older than MAX_QUEUE_AGE_MS (7 days)
 * @returns {Promise<number>} Number of events removed
 */
async function cleanOldEntries() {
	const db = await openDB();
	const maxAge = Date.now() - MAX_QUEUE_AGE_MS;

	return new Promise((resolve, reject) => {
		const tx = db.transaction([STORE_NAME], "readwrite");
		const store = tx.objectStore(STORE_NAME);
		const index = store.index("createdAt");

		const range = IDBKeyRange.upperBound(maxAge);
		const request = index.openCursor(range);

		let removedCount = 0;

		request.onerror = () => {
			console.error("[OfflineQueue] Failed to clean old entries:", request.error);
			reject(request.error);
		};

		request.onsuccess = (event) => {
			const cursor = event.target.result;
			if (cursor) {
				console.log("[OfflineQueue] Removing old event:", cursor.value.id);
				cursor.delete();
				removedCount++;
				cursor.continue();
			}
		};

		// Ensure DB is closed on all paths
		tx.oncomplete = () => {
			if (removedCount > 0) {
				console.log("[OfflineQueue] Cleaned", removedCount, "old entries");
			}
			db.close();
			resolve(removedCount);
		};
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
	});
}

/**
 * Clear all events (for logout or testing)
 * @returns {Promise<void>}
 */
async function clearAll() {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		const tx = db.transaction([STORE_NAME], "readwrite");
		const store = tx.objectStore(STORE_NAME);

		const request = store.clear();

		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			console.log("[OfflineQueue] Cleared all events");
			resolve();
		};

		// Ensure DB is closed on all paths
		tx.oncomplete = () => db.close();
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
	});
}

// Export for service worker
if (typeof self !== "undefined") {
	self.OfflineQueueDB = {
		enqueue,
		getPending,
		getCount,
		remove,
		incrementRetry,
		cleanOldEntries,
		clearAll,
	};
}
