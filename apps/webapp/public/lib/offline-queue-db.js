/** Durable browser recovery evidence. Shared by pages and the service worker. */
const DB_NAME = "z8-offline-queue";
// Version 2 adds the frozen command store (#279). Legacy rows stay where they are.
// Readers built for version 1 can no longer open the database, so an older worker
// fails closed instead of reading or deleting records it does not understand.
const DB_VERSION = 2;
const STORE_NAME = "clock-events";
const COMMAND_STORE_NAME = "clock-commands";

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
		// One versionchange transaction: either every step below commits, or the
		// database stays at its old version with its rows untouched.
		request.onupgradeneeded = (event) => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
				store.createIndex("createdAt", "createdAt", { unique: false });
				store.createIndex("organizationId", "organizationId", {
					unique: false,
				});
			}
			if (!db.objectStoreNames.contains(COMMAND_STORE_NAME)) {
				const commands = db.createObjectStore(COMMAND_STORE_NAME, {
					keyPath: "recoveryId",
				});
				commands.createIndex("operationId", "operationId", { unique: true });
			}
			if (event.oldVersion >= 1) {
				classifyLegacyRows(request.transaction.objectStore(STORE_NAME), () => {});
			}
		};
	});
}

async function transact(mode, operation, storeName = STORE_NAME) {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		let tx;
		let result;
		let failure;
		try {
			// Strict: a record reported as saved must survive an OS crash too.
			tx = db.transaction(
				storeName,
				mode,
				mode === "readwrite" ? { durability: "strict" } : undefined,
			);
			tx.oncomplete = () => {
				db.close();
				resolve(result);
			};
			tx.onerror = tx.onabort = () => {
				db.close();
				reject(
					failure ||
						tx.error ||
						new Error("Clock recovery storage transaction aborted"),
				);
			};
			operation(
				tx.objectStore(storeName),
				(value) => {
					result = value;
				},
				(error) => {
					failure = error;
					tx.abort();
				},
			);
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
	return transact("readwrite", classifyLegacyRows);
}

function classifyLegacyRows(store, done) {
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

// =============================================================================
// Frozen clock commands (#279)
// =============================================================================

const COMMAND_RECORD_FORMAT = "z8-clock-command-record-v1";
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Still owed a server outcome; the active queue. */
const ACTIVE_COMMAND_STATES = new Set(["pending", "exhausted", "review_required"]);
const COMMAND_CONTEXT_FIELDS = ["userId", "organizationId", "employeeId", "server"];

/**
 * Settled without a possible commit: refused, or archived after an outcome was
 * established. It no longer claims or blocks anything. An archived command that
 * may have committed still does, until a lookup settles it.
 */
function isReleased(record) {
	return (
		record.state === "rejected" || (record.state === "archived" && !record.uncertain)
	);
}

/** Owed an outcome that later work must wait for. */
function isUnsettled(record) {
	return ACTIVE_COMMAND_STATES.has(record.state) || (record.state === "archived" && record.uncertain);
}

/** Refused while the page watched, but not yet confirmed as shown. */
function isUnacknowledgedRejection(record) {
	return record.state === "rejected" && !record.resolvedAt;
}

class ClockCommandCaptureError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

function sameCommandContext(left, right) {
	return COMMAND_CONTEXT_FIELDS.every((field) => left[field] === right[field]);
}

function validCaptureRequest(request) {
	const context = request?.context;
	return (
		request &&
		(request.kind === "clock_in" || request.kind === "clock_out") &&
		typeof request.operationId === "string" &&
		OPERATION_ID.test(request.operationId) &&
		typeof request.occurredAt === "string" &&
		typeof request.timezone === "string" &&
		context &&
		COMMAND_CONTEXT_FIELDS.every((field) => typeof context[field] === "string" && context[field])
	);
}

/**
 * The clock-out target, read in the capture transaction: a still unconfirmed
 * clock-in on this device wins, then the period the page last saw active, then
 * the period of the latest committed clock-in. Never "whatever is active later".
 */
function resolveCaptureTarget(request, records) {
	const inContext = records.filter((record) =>
		sameCommandContext(record.command.context, request.context),
	);
	const claims = (record) =>
		inContext.some((other) => other.dependsOn === record.operationId && !isReleased(other));
	const clockIns = inContext
		.filter(
			(record) =>
				record.kind === "clock_in" &&
				!isReleased(record) &&
				!claims(record),
		)
		.sort((left, right) => right.sequence - left.sequence);
	const open = clockIns.find(isUnsettled);
	if (request.kind === "clock_in") {
		if (open) {
			throw new ClockCommandCaptureError(
				"clock_in_pending",
				"An earlier clock-in on this device is not confirmed yet",
			);
		}
		// A new period starts only after the unconfirmed close of the previous one.
		const closing = inContext
			.filter((record) => record.kind === "clock_out" && isUnsettled(record))
			.sort((left, right) => right.sequence - left.sequence)[0];
		return { target: null, dependsOn: closing?.operationId ?? null };
	}
	if (open) {
		return {
			target: { clockInOperationId: open.operationId },
			dependsOn: open.operationId,
		};
	}
	const committed = clockIns.find((record) => record.state === "committed");
	const workPeriodId =
		request.knownWorkPeriodId || committed?.receipt?.result?.workPeriodId;
	if (!workPeriodId) {
		throw new ClockCommandCaptureError(
			"no_target",
			"No known work period to clock out of",
		);
	}
	const duplicate = inContext.some(
		(record) =>
			record.kind === "clock_out" &&
			ACTIVE_COMMAND_STATES.has(record.state) &&
			record.command.target?.workPeriodId === workPeriodId,
	);
	if (duplicate) {
		throw new ClockCommandCaptureError(
			"clock_out_pending",
			"A clock-out for this work period is not confirmed yet",
		);
	}
	return { target: { workPeriodId }, dependsOn: null };
}

/**
 * Freeze one command before its first attempt. One readwrite transaction reads
 * the queue, binds the target and adds the record, so a failure leaves nothing.
 * Capturing the same request again returns the stored record unchanged.
 */
async function captureCommand(request) {
	if (!validCaptureRequest(request)) {
		throw new ClockCommandCaptureError("invalid_request", "Invalid clock command");
	}
	const requestJson = JSON.stringify(request);
	return transact(
		"readwrite",
		(store, done, fail) => {
			store.getAll().onsuccess = (event) => {
				const records = event.target.result;
				const existing = records.find(
					(record) => record.operationId === request.operationId,
				);
				if (existing) {
					if (existing.capture.requestJson === requestJson) {
						done({ record: existing, created: false });
					} else {
						fail(
							new ClockCommandCaptureError(
								"identity_conflict",
								"This clock action identity is already used",
							),
						);
					}
					return;
				}
				let binding;
				try {
					binding = resolveCaptureTarget(request, records);
				} catch (error) {
					fail(error);
					return;
				}
				const command = self.ClockCommandDispatch.buildCommand(request, binding.target);
				const record = {
					format: COMMAND_RECORD_FORMAT,
					recoveryId: crypto.randomUUID(),
					operationId: request.operationId,
					sequence: records.reduce((max, item) => Math.max(max, item.sequence), 0) + 1,
					revision: 1,
					kind: request.kind,
					command,
					body: JSON.stringify(command),
					dependsOn: binding.dependsOn,
					// Local storage observation; the event instant is command.occurredAt.
					capture: { capturedAt: Date.now(), requestJson },
					state: "pending",
					hold: null,
					attemptCount: 0,
					transientFailures: 0,
					uncertain: false,
					lastOutcome: null,
					receipt: null,
				};
				store.add(record);
				done({ record, created: true });
			};
		},
		COMMAND_STORE_NAME,
	);
}

async function listCommands() {
	return transact(
		"readonly",
		(store, done) => {
			store.getAll().onsuccess = (event) =>
				done(event.target.result.sort((left, right) => left.sequence - right.sequence));
		},
		COMMAND_STORE_NAME,
	);
}

/**
 * Read, check and write one record in a single transaction. The frozen command
 * and its identity are never part of a patch. `expectedRevision` null skips the
 * check, for receipts that must land even after a concurrent archive.
 */
async function updateCommand(recoveryId, expectedRevision, patch) {
	const {
		command: _command,
		body: _body,
		operationId: _operationId,
		recoveryId: _recoveryId,
		capture: _capture,
		...lifecycle
	} = patch;
	return transact(
		"readwrite",
		(store, done, fail) => {
			store.get(recoveryId).onsuccess = (event) => {
				const record = event.target.result;
				if (!record) {
					fail(new Error("Clock command record not found"));
					return;
				}
				if (expectedRevision !== null && record.revision !== expectedRevision) {
					fail(new Error("Clock command record changed meanwhile"));
					return;
				}
				const updated = { ...record, ...lifecycle, revision: record.revision + 1 };
				store.put(updated);
				done(updated);
			};
		},
		COMMAND_STORE_NAME,
	);
}

function canInspectCommand(record, context) {
	const captured = record?.command?.context;
	return Boolean(
		captured &&
			context?.userId &&
			context?.organizationId &&
			captured.userId === context.userId &&
			captured.organizationId === context.organizationId &&
			captured.server === context.serverOrigin,
	);
}

/** Visible archive of unresolved work. It stops automatic sending, nothing else. */
async function archiveCommand(recoveryId, context) {
	return transact(
		"readwrite",
		(store, done, fail) => {
			store.get(recoveryId).onsuccess = (event) => {
				const record = event.target.result;
				if (!record) {
					done(false);
					return;
				}
				if (!canInspectCommand(record, context)) {
					fail(new Error("This record belongs to another account or organization"));
					return;
				}
				if (ACTIVE_COMMAND_STATES.has(record.state) || isUnacknowledgedRejection(record)) {
					store.put({
						...record,
						state: "archived",
						archivedFrom: record.state,
						archivedAt: Date.now(),
						revision: record.revision + 1,
					});
				}
				done(true);
			};
		},
		COMMAND_STORE_NAME,
	);
}

/** The page showed a refusal to the person: it is now resolved. */
async function acknowledgeCommand(operationId) {
	return transact(
		"readwrite",
		(store, done) => {
			store.index("operationId").get(operationId).onsuccess = (event) => {
				const record = event.target.result;
				if (record && isUnacknowledgedRejection(record)) {
					store.put({ ...record, resolvedAt: Date.now(), revision: record.revision + 1 });
					done(true);
					return;
				}
				done(false);
			};
		},
		COMMAND_STORE_NAME,
	);
}

/**
 * Linked cleanup: only records whose receipt or acknowledged resolution is
 * stored, and that no unsettled command still names as its predecessor.
 */
async function pruneCommands(resolvedBefore) {
	return transact(
		"readwrite",
		(store, done) => {
			let removed = 0;
			const needed = new Set();
			store.getAll().onsuccess = (event) => {
				for (const record of event.target.result) {
					if (record.dependsOn && isUnsettled(record)) needed.add(record.dependsOn);
				}
				store.openCursor().onsuccess = prune;
			};
			const prune = (event) => {
				const cursor = event.target.result;
				if (!cursor) {
					done(removed);
					return;
				}
				const record = cursor.value;
				if (
					(record.state === "committed" || record.state === "rejected") &&
					record.resolvedAt < resolvedBefore &&
					!needed.has(record.operationId)
				) {
					cursor.delete();
					removed++;
				}
				cursor.continue();
			};
		},
		COMMAND_STORE_NAME,
	);
}

self.ClockCommandStore = {
	ACTIVE_STATES: ACTIVE_COMMAND_STATES,
	isUnacknowledgedRejection,
	capture: captureCommand,
	list: listCommands,
	update: updateCommand,
	archive: archiveCommand,
	acknowledge: acknowledgeCommand,
	prune: pruneCommands,
	canInspect: canInspectCommand,
};
