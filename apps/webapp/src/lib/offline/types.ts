/**
 * Offline queue types for clock events
 *
 * These types are shared between the service worker and React app.
 */

import type {
	BrowserClockCommandOutcome,
	ClockCommandCaptureRequest,
} from "@/lib/time-tracking/browser-clock-command";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";

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
	/** Captured account assertion; absent on legacy records, never backfilled. */
	userId?: string;
	/** Captured origin assertion; absent on legacy records. */
	serverOrigin?: string;
	/** Optional project ID for clock-out */
	projectId?: string;
	/** Optional work category ID for clock-out */
	workCategoryId?: string;
	/** Optional work location type for clock-in */
	workLocationType?: WorkLocationType;
	/** Browser timezone captured when the user clicked clock in/out */
	browserTimezone?: string | null;
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
	| { type: "QUEUE_UPDATED"; count?: number }
	| {
			type: "SYNC_SUCCESS";
			eventId: string;
			serverId: string;
			userId?: string;
			organizationId?: string;
	  }
	| { type: "SYNC_CONFLICT"; eventId: string; error: string }
	| { type: "SYNC_ERROR"; eventId?: string; error: string }
	| { type: "SYNC_STARTED" }
	| { type: "SYNC_COMPLETED"; successCount?: number; failureCount?: number }
	| { type: "SW_UPDATE_AVAILABLE" };

/**
 * Messages sent from clients to the service worker
 */
export type ClientToSWMessage =
	| {
			type: "QUEUE_CLOCK_EVENT";
			payload: Omit<QueuedClockEvent, "id" | "retryCount" | "createdAt">;
	  }
	| { type: "GET_QUEUE_COUNT"; context: OfflineRecoveryContext }
	| { type: "GET_QUEUE_RECORDS"; context: OfflineRecoveryContext }
	| {
			type: "ARCHIVE_QUEUE_RECORD";
			context: OfflineRecoveryContext;
			eventId: string;
	  }
	| { type: "TRIGGER_SYNC"; retryExhausted?: boolean }
	| { type: "CAPTURE_CLOCK_COMMAND"; payload: ClockCommandCaptureRequest }
	| {
			type: "DISPATCH_CLOCK_COMMANDS";
			/** The command the caller just captured and waits for. */
			operationId?: string;
			retryExhausted?: boolean;
	  }
	| { type: "CLEAR_OLD_QUEUE" }
	| { type: "SKIP_WAITING" }
	| { type: "GET_VERSION" };

/**
 * Offline queue status for UI display
 */
export interface OfflineQueueStatus {
	pendingCount: number;
	reviewCount: number;
	/** Frozen commands that will be sent automatically. */
	waitingCount: number;
	savedCount: number;
	/** False until an authenticated durable read establishes the total. */
	countVerified: boolean;
	isSyncing: boolean;
	lastSyncAt: number | null;
	lastError: string | null;
}

export interface OfflineRecoveryContext {
	userId: string;
	organizationId: string;
}

/** `CAPTURE_CLOCK_COMMAND` reply: durable local acceptance, or why there is none. */
export type ClockCommandCaptureReply =
	| { success: true; recoveryId: string; operationId: string; state: string }
	/** `message`, not `error`: the save definitely failed, it is not a worker fault. */
	| { success: false; code: string; message: string };

/** `DISPATCH_CLOCK_COMMANDS` reply: the run status and the caller's stored outcome. */
export type ClockCommandDispatchReply =
	| {
			success: true;
			status: string;
			record: (BrowserClockCommandOutcome & { operationId: string }) | null;
	  }
	| { success: false; error: string };

/** Legacy values remain uninterpreted, including unsupported fields. */
export interface OfflineRecoveryRecord extends Record<string, unknown> {
	id: string;
	recovery?: {
		state: string;
		reason: string;
		commitment: "unknown" | "committed";
		original?: Record<string, unknown>;
	};
}
