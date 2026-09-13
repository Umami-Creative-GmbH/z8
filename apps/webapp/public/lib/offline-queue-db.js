/** Durable browser recovery evidence. Shared by pages and the service worker. */
const DB_NAME = "z8-offline-queue";
// Additive fields in the existing store: no copy/delete migration or new identity.
const DB_VERSION = 1;
const STORE_NAME = "clock-events";

function openDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onblocked = () =>
			reject(new Error("Close older Z8 tabs to open clock recovery storage"));
		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
				store.createIndex("createdAt", "createdAt", { unique: false });
				store.createIndex("organizationId", "organizationId", {
					unique: false,
				});
			}
		};
	});
}

async function transact(mode, operation) {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		let tx;
		let result;
		try {
			tx = db.transaction(STORE_NAME, mode);
			tx.oncomplete = () => {
				db.close();
				resolve(result);
			};
			tx.onerror = tx.onabort = () => {
				db.close();
				reject(
					tx.error || new Error("Clock recovery storage transaction aborted"),
				);
			};
			operation(tx.objectStore(STORE_NAME), (value) => {
				result = value;
			});
		} catch (error) {
			tx?.abort();
			db.close();
			reject(error);
		}
	});
}

function reviewState(event) {
	return {
		version: 1,
		state: "review_required",
		reason: event.retryCount >= 5 ? "exhausted" : "legacy_evidence",
		// A local ID, age, or failed attempt cannot establish remote noncommitment.
		commitment: "unknown",
	};
}

async function enqueue(event) {
	// Preserve unknown fields, explicit nulls and the exact submitted evidence.
	// Incoming `id` may be a server action ID: never replace it in the original.
	const id = crypto.randomUUID();
	const record = {
		...event,
		id,
		retryCount: 0,
		createdAt: Date.now(), // local storage observation, not an event-time fallback
		recovery: { ...reviewState(event), original: event },
	};
	return transact("readwrite", (store, done) => {
		store.add(record);
		done(id);
	});
}

async function getRecords() {
	return transact("readonly", (store, done) => {
		// An index omits malformed legacy rows without createdAt. Retain those too.
		store.getAll().onsuccess = (event) => done(event.target.result);
	});
}

async function getPending() {
	return (await getRecords()).filter(
		(event) => event.recovery?.state !== "archived",
	);
}

async function getCount() {
	return (await getPending()).length;
}

/** Classify in one transaction; preserve original fields and all prior outcomes. */
async function retainForReview() {
	return transact("readwrite", (store, done) => {
		let retainedCount = 0;
		store.openCursor().onsuccess = (event) => {
			const cursor = event.target.result;
			if (!cursor) {
				done(retainedCount);
				return;
			}
			const record = cursor.value;
			if (!record.recovery) {
				cursor.update({
					...record,
					recovery: { ...reviewState(record), original: record },
				});
				retainedCount++;
			}
			cursor.continue();
		};
	});
}

/** Compatibility for older callers: age cleanup never purges unresolved work. */
async function cleanOldEntries() {
	await retainForReview();
	return 0;
}

async function archive(id, context) {
	return transact("readwrite", (store) => {
		store.get(id).onsuccess = (event) => {
			const record = event.target.result;
			if (!canInspect(record, context)) {
				store.transaction.abort();
				return;
			}
			store.put({
				...record,
				recovery: {
					...(record.recovery || { ...reviewState(record), original: record }),
					state: "archived",
					archivedAt: Date.now(),
				},
			});
		};
	});
}

function canInspect(record, context) {
	if (
		!record ||
		!context?.userId ||
		!context?.organizationId ||
		record.organizationId !== context.organizationId
	)
		return false;
	if (!record.userId) {
		// Origin-local legacy storage is evidence of location, not actor ownership.
		return (
			context.canReviewLegacy === true &&
			(!record.serverOrigin || record.serverOrigin === context.serverOrigin)
		);
	}
	return (
		record.userId === context.userId &&
		record.serverOrigin === context.serverOrigin
	);
}

// No delete/clear surface: local archive retains the linked original and outcomes.
// Privileged tenant/device erasure is a separate, explicitly authorized lifecycle.
self.OfflineQueueDB = {
	enqueue,
	getRecords,
	getPending,
	getCount,
	retainForReview,
	cleanOldEntries,
	archive,
	canInspect,
};
