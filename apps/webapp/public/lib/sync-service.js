/** Preservation-only browser clock adapter. No new clock protocol is activated. */
const TIME_ENTRIES_API = "/api/time-entries";

async function processQueue() {
	await self.OfflineQueueDB.retainForReview();
	const pending = await self.OfflineQueueDB.getPending();
	// Existing browser rows do not establish actor, business replay identity and
	// intended work. Even an intercepted action ID does not repair missing context.
	// Do not strip organization assertions, normalize evidence or send identity-less
	// work to whichever account/active period happens to be current. T03 preserves;
	// negotiated submit/outcome recovery and safe replay belong to client adoption.
	return {
		successCount: 0,
		failureCount: pending.length,
		reviewCount: pending.length,
		retryPending: false,
	};
}

async function broadcastMessage(message) {
	const clients = await self.clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	});
	for (const client of clients) client.postMessage(message);
}

async function notifyQueueUpdate() {
	// Broadcast invalidation only: counts, evidence and errors must be read through
	// authenticated scoped recovery, not disclosed to every open/login tab.
	await broadcastMessage({ type: "QUEUE_UPDATED" });
}

self.SyncService = {
	TIME_ENTRIES_API,
	processQueue,
	broadcastMessage,
	notifyQueueUpdate,
};
