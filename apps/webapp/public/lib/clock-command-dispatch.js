/**
 * Browser dispatch of frozen clock commands (#279 / T15, resolution #263 §1–§7).
 *
 * Every command reaching this module is already durably stored. A run reads the
 * server-derived context once, then walks the stored commands in local enqueue
 * order. It persists each attempt before sending, sends the stored bytes, and
 * persists the receipt or the typed outcome afterwards. A command leaves the
 * active queue only through that receipt or resolution write.
 */
const COMMANDS_API = "/api/time-entries/commands";
const MAX_TRANSIENT_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 20000;
/** Committed/rejected records stay inspectable this long, then are removed. */
const RESOLVED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Retried automatically once the condition clears; nothing was written. */
const HOLD_CODES = new Set([
	"unauthorized",
	"billing_required",
	"access_denied",
	"not_adopted",
	"context_mismatch",
	"unsupported_version",
]);
/** Definitive server refusals that need a person. Nothing was written. */
const REVIEW_CODES = new Set([
	"invalid_command",
	"collision",
	"target_unknown",
	"target_not_active",
	"already_clocked_in",
	"occupancy_conflict",
	"append_review_required",
	"integrity_review_required",
	"admission_window",
	"not_allowed_at_time",
	"invalid_interval",
	"attribution_not_allowed",
	"approval_routing",
]);
const CONTEXT_FIELDS = ["userId", "organizationId", "employeeId", "server"];

function attribution(value) {
	return value.kind === "replace" ? { kind: "replace", id: value.id } : { kind: value.kind };
}

/**
 * The frozen version 2 command, built once at capture with a fixed key order.
 * Its serialization is stored and every attempt sends exactly those bytes.
 */
function buildCommand(request, target) {
	const command = {
		version: 2,
		operationId: request.operationId,
		kind: request.kind,
		admission: request.admission,
		occurredAt: request.occurredAt,
		timezone: request.timezone,
		context: {
			userId: request.context.userId,
			organizationId: request.context.organizationId,
			employeeId: request.context.employeeId,
			server: request.context.server,
		},
	};
	if (request.kind === "clock_in") {
		command.workLocationType = request.workLocationType;
		return command;
	}
	command.target = target.clockInOperationId
		? { clockInOperationId: target.clockInOperationId }
		: { workPeriodId: target.workPeriodId };
	command.project = attribution(request.project);
	command.workCategory = attribution(request.workCategory);
	return command;
}

function contextMismatch(asserted, current) {
	return CONTEXT_FIELDS.filter((field) => asserted[field] !== current[field]);
}

async function readJson(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

/** One submission response as a typed outcome. Anything unexpected is uncertain. */
function classifySubmission(status, body) {
	if (
		(status === 200 || status === 201) &&
		body &&
		(body.outcome === "executed" || body.outcome === "replayed") &&
		body.receipt
	) {
		return {
			kind: "committed",
			outcome: body.outcome,
			receipt: body.receipt,
			clockOut: body.clockOut ?? null,
		};
	}
	if (status === 401) return { kind: "hold", reason: "unauthorized" };
	const code = body && body.outcome === "rejected" ? body.code : null;
	if (code && HOLD_CODES.has(code)) {
		return { kind: "hold", reason: code, ...(body.fields ? { fields: body.fields } : {}) };
	}
	if (code && REVIEW_CODES.has(code)) {
		return {
			kind: "rejected",
			code,
			...(body.holidayName ? { holidayName: body.holidayName } : {}),
			...(body.reason ? { reason: body.reason } : {}),
			...(body.field ? { field: body.field } : {}),
		};
	}
	if (status === 400) return { kind: "rejected", code: "invalid_command" };
	return { kind: "transient", status };
}

/** Why a stored command may not be sent now, or what to do with it. */
function evaluate(record, byOperation, capabilities) {
	if (!capabilities.commandVersions.includes(record.command.version)) {
		return { action: "hold", hold: { reason: "unsupported_version" } };
	}
	const fields = contextMismatch(record.command.context, capabilities.context);
	if (fields.length) return { action: "hold", hold: { reason: "context_mismatch", fields } };
	if (record.state === "review_required" || record.state === "archived") {
		return { action: "lookup" };
	}
	if (record.dependsOn) {
		const predecessor = byOperation.get(record.dependsOn);
		// A pruned predecessor committed; the server resolves it by operation ID.
		if (predecessor && predecessor.state !== "committed") {
			return {
				action: "hold",
				hold: {
					reason: predecessor.state === "pending" ? "predecessor_waiting" : "predecessor_blocked",
					operationId: record.dependsOn,
				},
			};
		}
	}
	if (capabilities.submit !== "available") {
		// Committed replay and lookup work in every mode; fresh work waits.
		return record.uncertain
			? { action: "lookup" }
			: { action: "hold", hold: { reason: "not_adopted" } };
	}
	return { action: "send" };
}

function sameHold(left, right) {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function fetchCapabilities(fetchImpl, origin) {
	let response;
	try {
		response = await fetchImpl(new URL(COMMANDS_API, origin).href, {
			method: "GET",
			cache: "no-store",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		return { status: "offline" };
	}
	if (response.status === 401) return { status: "unauthorized" };
	if (response.status === 403) return { status: "access_denied" };
	const body = response.ok ? await readJson(response) : null;
	if (!body || !Array.isArray(body.commandVersions) || !body.context) {
		return { status: "unavailable" };
	}
	return { status: "ready", capabilities: body };
}

function committedPatch(outcome, now) {
	return {
		state: "committed",
		hold: null,
		uncertain: false,
		receipt: outcome.receipt,
		clockOut: outcome.clockOut ?? null,
		lastOutcome: { kind: "committed", outcome: outcome.outcome, at: now },
		resolvedAt: now,
	};
}

async function runOnce(options) {
	const { store, origin } = options;
	const fetchImpl = options.fetch;
	const now = options.now ?? (() => Date.now());
	const records = await store.list();
	const byOperation = new Map(records.map((record) => [record.operationId, record]));
	const candidates = records.filter(
		(record) =>
			record.state === "pending" ||
			(record.state === "exhausted" && options.retryExhausted) ||
			(record.state === "review_required" && record.uncertain) ||
			// Archiving never cancels a possible commit: keep establishing it.
			(record.state === "archived" && record.uncertain),
	);
	const committed = [];
	const finish = async (status) => {
		await store.prune(now() - RESOLVED_RETENTION_MS);
		return { status, committed, records: [...byOperation.values()] };
	};
	if (!candidates.length) return finish("idle");

	const read = await fetchCapabilities(fetchImpl, origin);
	if (read.status !== "ready") return finish(read.status);
	const { capabilities } = read;

	const save = async (record, patch, checkRevision = true) => {
		const updated = await store.update(
			record.recoveryId,
			checkRevision ? record.revision : null,
			patch,
		);
		byOperation.set(updated.operationId, updated);
		if (updated.state === "committed" && record.state !== "committed") {
			committed.push({
				operationId: updated.operationId,
				userId: updated.command.context.userId,
				organizationId: updated.command.context.organizationId,
			});
		}
		return updated;
	};

	for (const candidate of candidates) {
		const record = byOperation.get(candidate.operationId);
		const decision = evaluate(record, byOperation, capabilities);
		if (decision.action === "hold") {
			if (!sameHold(record.hold, decision.hold)) await save(record, { hold: decision.hold });
			continue;
		}
		if (decision.action === "lookup") {
			await lookUp(record, { fetchImpl, origin, now, save });
			continue;
		}

		const wasUncertain = record.uncertain;
		const firstAttempt = record.attemptCount === 0;
		// Persist the attempt first: a crash after this point leaves the outcome
		// uncertain, never a record that looks unsent.
		const attempting = await save(record, {
			state: "pending",
			hold: null,
			uncertain: true,
			attemptCount: record.attemptCount + 1,
			lastAttemptAt: now(),
			transientFailures: record.state === "exhausted" ? 0 : (record.transientFailures ?? 0),
		});
		let outcome;
		try {
			const response = await fetchImpl(new URL(COMMANDS_API, origin).href, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: attempting.body,
				cache: "no-store",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			outcome = classifySubmission(response.status, await readJson(response));
		} catch {
			outcome = { kind: "transient", status: 0 };
		}

		if (outcome.kind === "committed") {
			// The receipt is recorded even if the record was archived meanwhile:
			// archiving never cancels a remote commitment.
			await save(attempting, committedPatch(outcome, now()), false);
		} else if (outcome.kind === "hold") {
			await save(attempting, {
				uncertain: wasUncertain,
				hold: { reason: outcome.reason, ...(outcome.fields ? { fields: outcome.fields } : {}) },
				lastOutcome: { ...outcome, at: now() },
			});
		} else if (outcome.kind === "rejected") {
			const attended =
				options.attendedOperationId === record.operationId && firstAttempt && !wasUncertain;
			await save(attempting, {
				// Only a refusal the person is shown, of a command that was never
				// uncertain, becomes `rejected`. It counts as unresolved until the page
				// acknowledges that it displayed it. Everything else is kept for review.
				state: attended ? "rejected" : "review_required",
				uncertain: wasUncertain,
				lastOutcome: { kind: "rejected", ...stripKind(outcome), at: now() },
			});
		} else {
			const transientFailures = (attempting.transientFailures ?? 0) + 1;
			await save(attempting, {
				state: transientFailures >= MAX_TRANSIENT_ATTEMPTS ? "exhausted" : "pending",
				transientFailures,
				lastOutcome: { kind: "transient", status: outcome.status, at: now() },
			});
		}
	}
	return finish("done");
}

function stripKind(outcome) {
	const { kind: _kind, ...rest } = outcome;
	return rest;
}

/** Lookup-only recovery: it can establish a commit, never create one. */
async function lookUp(record, { fetchImpl, origin, now, save }) {
	let body = null;
	try {
		const response = await fetchImpl(
			new URL(`${COMMANDS_API}/${record.operationId}`, origin).href,
			{ method: "GET", cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
		);
		body = response.ok ? await readJson(response) : null;
	} catch {
		return;
	}
	if (body?.outcome === "committed" && body.receipt) {
		await save(
			record,
			{
				...committedPatch({ outcome: "replayed", receipt: body.receipt }, now()),
				evidence: body.evidence,
			},
			false,
		);
	} else if (body?.outcome === "not_committed" || body?.outcome === "conflict") {
		await save(record, {
			uncertain: false,
			lastLookup: { outcome: body.outcome, at: now() },
		});
	}
}

let queue = Promise.resolve();

/** Runs are serialized: one sender per worker, in enqueue order. */
function process(options) {
	const run = queue.then(() => runOnce(options));
	queue = run.catch(() => {});
	return run;
}

self.ClockCommandDispatch = {
	COMMANDS_API,
	MAX_TRANSIENT_ATTEMPTS,
	RESOLVED_RETENTION_MS,
	buildCommand,
	classifySubmission,
	evaluate,
	process,
};
