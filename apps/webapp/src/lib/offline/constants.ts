/**
 * Constants for offline queue functionality
 */

/** IndexedDB database name */
export const DB_NAME = "z8-offline-queue";

/** IndexedDB database version */
export const DB_VERSION = 1;

/** IndexedDB object store name */
export const STORE_NAME = "clock-events";

/** Maximum age of queued events before cleanup (7 days in ms) */
export const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum retry attempts before giving up */
export const MAX_RETRY_COUNT = 5;

/** Background sync tag */
export const SYNC_TAG = "clock-sync";

/** Cache name for app shell */
export const APP_SHELL_CACHE = "z8-app-shell-v1";

/** Cache name for push notifications (existing) */
export const PUSH_CACHE = "z8-push-v1";

/** API endpoint for time entries */
export const TIME_ENTRIES_API = "/api/time-entries";

/** API endpoint for clock status */
export const CLOCK_STATUS_API = "/api/time-entries/status";

/** Routes to precache for offline access */
export const PRECACHE_ROUTES = [
	"/",
	"/time-tracking",
];

/** Static asset patterns to cache */
export const STATIC_ASSET_PATTERNS = [
	/^\/_next\/static\/.*/,
	/^\/android-chrome-.*\.png$/,
	/^\/favicon.*\.png$/,
	/^\/apple-touch-icon\.png$/,
];

/** Message channel name for SW-client communication */
export const MESSAGE_CHANNEL = "z8-offline";
