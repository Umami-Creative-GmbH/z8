/**
 * Offline queue types for clock events
 *
 * These types are shared between the service worker and React app.
 */

/**
 * A clock event queued for offline sync
 */
export interface QueuedClockEvent {
	/** Unique ID for the queued event */
	id: string;
	/** Type of clock event */
	type: "clock_in" | "clock_out";
	/** Timestamp when the user clicked clock in/out (Unix ms) */
	timestamp: number;
	/** Optional notes for the clock event */
	notes?: string;
	/** Optional location data */
	location?: {
		latitude: number;
		longitude: number;
	};
	/** Number of sync retry attempts */
	retryCount: number;
	/** When the event was added to the queue (Unix ms) */
	createdAt: number;
	/** Organization ID for multi-tenant isolation */
	organizationId: string;
	/** Optional project ID for clock-out */
	projectId?: string;
	/** Optional work category ID for clock-out */
	workCategoryId?: string;
}

/**
 * Result of a sync attempt
 */
export type SyncResult =
	| { success: true; serverId: string }
	| { success: false; error: string; isConflict: boolean; statusCode?: number };

/**
 * Messages sent from the service worker to clients
 */
export type SWToClientMessage =
	| { type: "QUEUE_UPDATED"; count: number }
	| { type: "SYNC_SUCCESS"; eventId: string; serverId: string }
	| { type: "SYNC_CONFLICT"; eventId: string; error: string }
	| { type: "SYNC_ERROR"; eventId: string; error: string }
	| { type: "SYNC_STARTED" }
	| { type: "SYNC_COMPLETED"; successCount: number; failureCount: number }
	| { type: "SW_UPDATE_AVAILABLE" };

/**
 * Messages sent from clients to the service worker
 */
export type ClientToSWMessage =
	| { type: "QUEUE_CLOCK_EVENT"; payload: Omit<QueuedClockEvent, "id" | "retryCount" | "createdAt"> }
	| { type: "GET_QUEUE_COUNT" }
	| { type: "TRIGGER_SYNC" }
	| { type: "CLEAR_OLD_QUEUE" }
	| { type: "SKIP_WAITING" }
	| { type: "GET_VERSION" };

/**
 * Offline queue status for UI display
 */
export interface OfflineQueueStatus {
	pendingCount: number;
	isSyncing: boolean;
	lastSyncAt: number | null;
	lastError: string | null;
}
