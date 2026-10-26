/** Proofs are prospective; a canceled request is never a successful payload. */
import { createHash } from "node:crypto";
export const controlCancellationPolicy = Object.freeze({
	version: 1,
	protocol: "positively-proven-protocol-controls-v1",
	encodedLimit: 4 * 1024 * 1024,
	decodedLimit: 8 * 1024 * 1024,
	retainedLimit: 32 * 1024 * 1024,
	recordLimit: 10000,
});
export const chromiumSWRRevision = "1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775";
export const bodySha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");

export function inspectRequiredFlightBody(
	bytes,
	{
		action = false,
		cachedNavigations,
		requestKind = action ? "action" : "navigation",
	} = {},
) {
	const unknown = (reason) => ({ complete: false, reason });
	if (
		!["action", "navigation", "route-tree"].includes(requestKind) ||
		action !== (requestKind === "action")
	)
		return unknown("unsupported-request-contract");
	if (
		!Buffer.isBuffer(bytes) ||
		bytes.length > controlCancellationPolicy.decodedLimit
	)
		return unknown("bounded-body-unavailable");
	const marker =
		bytes[0] === 35
			? "complete"
			: bytes[0] === 126
				? "partial"
				: action
					? "unmarked-action"
					: typeof cachedNavigations === "boolean"
						? "unmarked-navigation"
						: null;
	if (!marker) return unknown("unsupported-marker");
	const isPartial =
		marker === "partial" ||
		(marker === "unmarked-navigation" && cachedNavigations);
	const body = marker.startsWith("unmarked-") ? bytes : bytes.subarray(1),
		records = new Map();
	const utf8 = new TextDecoder("utf-8", { fatal: true });
	let offset = 0,
		serverErrors = 0,
		recordCount = 0;
	try {
		while (offset < body.length) {
			if (++recordCount > 4096) return unknown("record-limit");
			if (
				body[offset] === 58 &&
				body[offset + 1] === 72 &&
				/[DCLmSXM]/.test(String.fromCharCode(body[offset + 2]))
			) {
				const end = body.indexOf(10, offset);
				if (end < offset) return unknown("incomplete-hint");
				JSON.parse(utf8.decode(body.subarray(offset + 3, end)));
				offset = end + 1;
				continue;
			}
			const colon = body.indexOf(58, offset);
			const id = body.subarray(offset, colon).toString();
			if (colon < offset || !/^[a-f0-9]+$/.test(id) || records.has(id))
				return unknown("invalid-record");
			let start = colon + 1,
				end,
				value;
			const tag = /^[A-Z]$/.test(String.fromCharCode(body[start]))
				? String.fromCharCode(body[start++])
				: null;
			if (tag === "T") {
				const comma = body.indexOf(44, start),
					length = body.subarray(start, comma).toString();
				if (comma < start || !/^[a-f0-9]+$/.test(length))
					return unknown("invalid-text-length");
				end = comma + 1 + Number.parseInt(length, 16);
				if (!Number.isSafeInteger(end) || end > body.length)
					return unknown("incomplete-text");
				utf8.decode(body.subarray(comma + 1, end));
			} else {
				end = body.indexOf(10, start);
				if (end < start || ![null, "I", "H", "D", "E"].includes(tag))
					return unknown("unsupported-record");
				value = JSON.parse(utf8.decode(body.subarray(start, end)));
				end++;
				if (tag === "E") serverErrors++;
			}
			records.set(id, { value, tag, end });
			offset = end;
		}
	} catch {
		return unknown("invalid-record");
	}
	if (serverErrors)
		return { complete: false, reason: "flight-server-error", serverErrors };
	const root = records.get("0")?.value;
	if (
		!root ||
		typeof root !== "object" ||
		Array.isArray(root) ||
		(Object.hasOwn(root, "b") && typeof root.b !== "string") ||
		(action ? !Object.hasOwn(root, "a") : !Object.hasOwn(root, "t"))
	)
		return unknown("unsupported-root");
	const resolve = (value) => {
		const seen = new Set();
		while (typeof value === "string" && /^\$@?[a-f0-9]+$/.test(value)) {
			const id = value.replace(/^\$@?/, "");
			if (seen.has(id) || seen.size >= 8) return undefined;
			seen.add(id);
			value = records.get(id)?.value;
		}
		return value;
	};
	if (requestKind === "route-tree") {
		// The exact /_tree consumer buffers the WHOLE response, then reads structure only.
		// Other endpoint contracts and arbitrary pending data are not covered by this branch.
		if (
			Object.keys(root).some((key) => !["b", "t", "S", "q", "i"].includes(key))
		)
			return unknown("unsupported-tree-metadata");
		const transport = resolve(root.t);
		if (
			!transport ||
			typeof transport !== "object" ||
			Array.isArray(transport) ||
			Object.keys(transport).some((key) => key !== "t")
		)
			return unknown("unsupported-tree-transport");
		const queue = [transport.t],
			visited = new Set();
		let nodes = 0;
		while (queue.length) {
			if (++nodes > 4096) return unknown("tree-limit");
			const node = resolve(queue.pop());
			if (
				!node ||
				typeof node !== "object" ||
				Array.isArray(node) ||
				visited.has(node) ||
				Object.keys(node).some((key) => !["s", "h", "c"].includes(key))
			)
				return unknown("unresolved-tree-structure");
			visited.add(node);
			const segment = resolve(node.s);
			if (typeof segment === "string") {
				if (segment.startsWith("$") && !segment.startsWith("$$"))
					return unknown("unsupported-tree-segment");
			} else if (
				!segment ||
				typeof segment !== "object" ||
				Array.isArray(segment) ||
				typeof segment.n !== "string" ||
				typeof segment.t !== "string" ||
				!(segment.k === null || typeof segment.k === "string") ||
				!(
					segment.s === null ||
					(Array.isArray(segment.s) &&
						segment.s.every((value) => typeof value === "string"))
				)
			)
				return unknown("unsupported-tree-segment");
			if (node.h !== undefined && (!Number.isSafeInteger(node.h) || node.h < 0))
				return unknown("unsupported-tree-hints");
			if (node.c !== undefined) {
				if (typeof node.c !== "string" || !/^\$Q[a-f0-9]+$/.test(node.c))
					return unknown("unsupported-tree-map");
				const children = records.get(node.c.slice(2))?.value;
				if (!Array.isArray(children) || children.length > 4096)
					return unknown("unresolved-tree-structure");
				const slots = new Set();
				for (const pair of children) {
					if (
						!Array.isArray(pair) ||
						pair.length !== 2 ||
						typeof pair[0] !== "string" ||
						slots.has(pair[0])
					)
						return unknown("unsupported-tree-map");
					slots.add(pair[0]);
					queue.push(pair[1]);
				}
			}
		}
		return {
			protocol: "bounded-required-flight-v1",
			complete: true,
			requestKind,
			marker,
			isPartial: Boolean(isPartial),
			...(marker === "unmarked-navigation" ? { cachedNavigations } : {}),
			action: false,
			requiredStage: "route-tree-structure",
			treeNodes: nodes,
			boundaryBytes: body.length,
			decodedBytes: bytes.length,
			bodySha256: bodySha256(bytes),
			serverErrors: 0,
			explicitActionFailure: false,
		};
	}
	const queue = [root],
		visited = new Set();
	let inspected = 0;
	while (queue.length) {
		if (++inspected > 100000) return unknown("model-limit");
		const value = queue.pop();
		if (typeof value === "string" && /^\$(?:@|L|F)?[a-f0-9]+$/.test(value)) {
			const id = value.replace(/^\$(?:@|L|F)?/, "");
			if (!records.has(id)) return unknown("unresolved-model-reference");
			if (!visited.has(id)) {
				visited.add(id);
				queue.push(records.get(id).value);
			}
		} else if (
			typeof value === "string" &&
			value.startsWith("$") &&
			!value.startsWith("$$") &&
			!["$", "$undefined", "$NaN", "$Infinity", "$-Infinity", "$-0"].includes(
				value,
			)
		) {
			return unknown("unsupported-model-reference");
		} else if (value && typeof value === "object") {
			const values = Object.values(value);
			if (values.length + queue.length > 100000) return unknown("model-limit");
			for (const item of values) queue.push(item);
		}
	}
	if (!action) {
		const transport = resolve(root.t),
			tree = resolve(transport?.t);
		if (
			!transport ||
			typeof transport !== "object" ||
			!tree ||
			typeof tree !== "object" ||
			!(
				typeof resolve(tree.s) === "string" ||
				(resolve(tree.s) && typeof resolve(tree.s) === "object")
			)
		)
			return unknown("unsupported-navigation-transport");
	}
	if (action) {
		let result = root.a;
		const seen = new Set();
		while (typeof result === "string" && /^\$@?[a-f0-9]+$/.test(result)) {
			const id = result.replace(/^\$@?/, "");
			if (seen.has(id) || seen.size >= 8)
				return unknown("unresolved-action-result");
			seen.add(id);
			result = records.get(id)?.value;
		}
		if (result?.success === false && typeof result.error === "string")
			return {
				complete: false,
				reason: "explicit-root-action-failure",
				explicitActionFailure: true,
			};
	}
	const boundary = (value) => {
		const seen = new Set();
		while (typeof value === "string" && /^\$@?[a-f0-9]+$/.test(value)) {
			const id = value.replace(/^\$@?/, "");
			if (seen.has(id) || seen.size >= 8 || !records.has(id)) return null;
			seen.add(id);
			value = records.get(id).value;
		}
		return Number.isSafeInteger(value) && value >= 0 ? value : null;
	};
	if (!action)
		for (const key of ["l", "a"]) {
			if (
				Object.hasOwn(root, key) &&
				!(key === "a" && root[key] === null) &&
				boundary(root[key]) === null
			)
				return unknown("unsupported-boundary-metadata");
		}
	let requiredStage = "full",
		boundaryBytes = body.length;
	if (isPartial) {
		const staticBytes = boundary(root.l),
			shellBytes = boundary(root.a);
		if (staticBytes === null && shellBytes === null)
			return unknown("unresolved-required-boundary");
		boundaryBytes = staticBytes > 0 ? staticBytes : shellBytes;
		requiredStage = staticBytes > 0 ? "static" : "shell";
		if (
			!Number.isSafeInteger(boundaryBytes) ||
			boundaryBytes <= 0 ||
			boundaryBytes > body.length ||
			![...records.values()].some((record) => record.end === boundaryBytes)
		)
			return unknown("incomplete-required-boundary");
	}
	return {
		protocol: "bounded-required-flight-v1",
		complete: true,
		requestKind,
		marker,
		isPartial: Boolean(isPartial),
		...(marker === "unmarked-navigation" ? { cachedNavigations } : {}),
		action,
		requiredStage,
		boundaryBytes,
		decodedBytes: bytes.length,
		bodySha256: bodySha256(bytes),
		serverErrors: 0,
		explicitActionFailure: false,
	};
}

const digest = (value) =>
	typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sameRequest = (a, b) =>
	digest(a.fullUrlSha256) &&
	digest(a.requestHeadersSha256) &&
	[
		"contextId",
		"fullUrlSha256",
		"requestHeadersSha256",
		"documentGeneration",
		"method",
		"requestKind",
	].every(
		(key) =>
			typeof a[key] === "string" && a[key].length > 0 && a[key] === b[key],
	);
const goodBody = (proof) => {
	if (
		proof?.complete !== true ||
		!digest(proof.bodySha256) ||
		proof.protocol !== "bounded-required-flight-v1" ||
		typeof proof.action !== "boolean" ||
		typeof proof.isPartial !== "boolean" ||
		proof.serverErrors !== 0 ||
		proof.explicitActionFailure !== false ||
		!Number.isSafeInteger(proof.decodedBytes) ||
		proof.decodedBytes <= 0 ||
		proof.decodedBytes > controlCancellationPolicy.decodedLimit ||
		!Number.isSafeInteger(proof.boundaryBytes) ||
		proof.boundaryBytes <= 0 ||
		proof.boundaryBytes > proof.decodedBytes
	)
		return false;
	if (proof.marker === "complete") {
		if (proof.isPartial) return false;
	} else if (proof.marker === "partial") {
		if (!proof.isPartial) return false;
	} else if (proof.marker === "unmarked-action") {
		if (!proof.action || proof.isPartial) return false;
	} else if (proof.marker === "unmarked-navigation") {
		if (
			proof.action ||
			typeof proof.cachedNavigations !== "boolean" ||
			proof.isPartial !== proof.cachedNavigations
		)
			return false;
	} else return false;
	if (proof.requiredStage === "route-tree-structure")
		return (
			proof.requestKind === "route-tree" &&
			!proof.action &&
			Number.isSafeInteger(proof.treeNodes) &&
			proof.treeNodes > 0 &&
			proof.treeNodes <= 4096
		);
	if (
		proof.action !== (proof.requestKind === "action") ||
		!["action", "navigation"].includes(proof.requestKind)
	)
		return false;
	return proof.requiredStage === "full"
		? !proof.isPartial
		: ["static", "shell"].includes(proof.requiredStage) && proof.isPartial;
};
const pick = (row, keys) =>
	Object.fromEntries(
		keys
			.filter((key) => row?.[key] !== undefined)
			.map((key) => [key, row[key]]),
	);
const bodyReceipt = (row) =>
	pick(row, [
		"protocol",
		"complete",
		"requestKind",
		"marker",
		"isPartial",
		"cachedNavigations",
		"action",
		"requiredStage",
		"treeNodes",
		"boundaryBytes",
		"decodedBytes",
		"bodySha256",
		"serverErrors",
		"explicitActionFailure",
	]);
const receivedBody = (row) =>
	row.bodyReadbackComplete === true ||
	(row.streamReceipt?.protocol === "passive-network-copy-v1" &&
		row.streamReceipt.sourceRevision === chromiumSWRRevision &&
		row.streamReceipt.captureComplete === true &&
		["failed", "finished"].includes(row.streamReceipt.terminal) &&
		Number.isSafeInteger(row.streamReceipt.capturedBytes) &&
		row.streamReceipt.capturedBytes > 0 &&
		row.streamReceipt.capturedBytes === row.streamReceipt.observedDataLength &&
		row.streamReceipt.capturedBytes === row.bodyProof?.decodedBytes &&
		row.streamReceipt.reason === null);
const requestReceipt = (row) => ({
	...pick(row, [
		"contextId",
		"requestId",
		"id",
		"traceId",
		"loaderId",
		"fullUrlSha256",
		"requestHeadersSha256",
		"documentGeneration",
		"method",
		"requestKind",
		"status",
		"action",
		"flight",
		"prefetch",
		"type",
		"initiator",
		"initiatorStackKnownAbsent",
		"priority",
		"startedAt",
		"finishedAt",
		"canceled",
		"error",
		"proxyResponseId",
		"bodyReadbackComplete",
		"ambiguousRedirect",
		"httpErrorObserved",
		"upstreamError",
		"complete",
		"staleWhileRevalidateSeconds",
		"fromDiskCache",
		"fromServiceWorker",
		"loadingFinished",
		"failed",
	]),
	...(row?.bodyProof ? { bodyProof: bodyReceipt(row.bodyProof) } : {}),
	...(row?.streamReceipt
		? {
				streamReceipt: pick(row.streamReceipt, [
					"protocol",
					"sourceRevision",
					"captureComplete",
					"terminal",
					"capturedBytes",
					"observedDataLength",
					"reason",
				]),
			}
		: {}),
});

/** Input records are emitted by the owned passive collector, never inferred from labels alone. */
export function classifyControlCancellations({
	failures = [],
	responses = [],
	proxy = [],
	coverage,
	browserRevision,
	scope = "measured",
}) {
	const records = [],
		seen = new Set();
	let realFailures = 0,
		unknownFailures = 0,
		provenControls = 0;
	let complete =
		coverage?.installed === true &&
		coverage?.scopeClosed === true &&
		["missing", "overflow", "errors", "pendingBodies"].every(
			(key) => coverage[key] === 0,
		) &&
		failures.length <= controlCancellationPolicy.recordLimit;
	for (const failure of failures) {
		const key = `${failure.contextId}:${failure.requestId}`;
		if (!failure.requestId || seen.has(key)) complete = false;
		seen.add(key);
		let outcome = "unknown",
			reason = "unproven-cancellation",
			proof;
		if (
			(typeof failure.error === "string" &&
				/^net::ERR_[A-Z_]+$/.test(failure.error) &&
				failure.error !== "net::ERR_ABORTED") ||
			failure.status >= 400
		) {
			outcome = "real-failure";
			reason = "browser-or-http-error";
		} else if (
			failure.error === "net::ERR_ABORTED" &&
			failure.canceled === true
		) {
			const matches = proxy.filter(
				(row) =>
					sameRequest(failure, row) &&
					(!failure.proxyResponseId || failure.proxyResponseId === row.id),
			);
			const packet = matches.length === 1 ? matches[0] : null;
			if (
				failure.bodyProof?.explicitActionFailure === true ||
				failure.bodyProof?.serverErrors > 0 ||
				(packet &&
					(packet.status >= 400 ||
						packet.upstreamError === true ||
						packet.bodyProof?.explicitActionFailure === true ||
						packet.bodyProof?.serverErrors > 0))
			) {
				outcome = "real-failure";
				reason = "server-or-application-error";
			} else if (
				packet &&
				failure.ambiguousRedirect !== true &&
				failure.httpErrorObserved !== true &&
				packet.status === 200 &&
				packet.upstreamError === false
			) {
				if (
					packet.complete === true &&
					packet.canceled === false &&
					packet.flight === true &&
					goodBody(failure.bodyProof) &&
					goodBody(packet.bodyProof) &&
					receivedBody(failure) &&
					failure.action === packet.action &&
					failure.bodyProof.action === failure.action &&
					packet.bodyProof.action === packet.action &&
					failure.bodyProof.requestKind === failure.requestKind &&
					packet.bodyProof.requestKind === packet.requestKind &&
					failure.bodyProof.bodySha256 === packet.bodyProof.bodySha256
				) {
					outcome = "protocol-control";
					reason = "completed-flight-late-terminal-cancel";
					proof = {
						failure: requestReceipt(failure),
						packet: requestReceipt(packet),
						cached: null,
						browserRevision,
						proxyCandidates: 1,
					};
				} else if (
					browserRevision === chromiumSWRRevision &&
					packet.canceled === true &&
					packet.action === false &&
					failure.action === false &&
					packet.flight === true &&
					failure.method === "GET" &&
					failure.prefetch === true &&
					failure.type === "Other" &&
					failure.initiator === "other" &&
					failure.initiatorStackKnownAbsent === true &&
					failure.priority === "VeryLow" &&
					packet.staleWhileRevalidateSeconds > 0
				) {
					const cached = responses.filter(
						(row) =>
							sameRequest(failure, row) &&
							row.requestId !== failure.requestId &&
							row.loaderId === failure.loaderId &&
							row.fromDiskCache === true &&
							row.fromServiceWorker === false &&
							row.ambiguousRedirect !== true &&
							row.httpErrorObserved !== true &&
							row.status === 200 &&
							row.loadingFinished === true &&
							row.failed === false &&
							row.staleWhileRevalidateSeconds > 0 &&
							receivedBody(row) &&
							Number.isFinite(row.finishedAt) &&
							row.finishedAt <= failure.startedAt &&
							row.action === false &&
							row.flight === true &&
							goodBody(row.bodyProof) &&
							row.bodyProof.action === false &&
							row.bodyProof.requestKind === row.requestKind,
					);
					if (cached.length === 1) {
						outcome = "protocol-control";
						reason = "complete-cached-flight-native-revalidation";
						proof = {
							failure: requestReceipt(failure),
							packet: requestReceipt(packet),
							cached: requestReceipt(cached[0]),
							browserRevision,
							proxyCandidates: 1,
							cachedCandidates: 1,
						};
					}
				}
			}
		}
		if (outcome === "real-failure") realFailures++;
		else if (outcome === "protocol-control") provenControls++;
		else unknownFailures++;
		records.push({
			requestId: failure.requestId ?? null,
			outcome,
			reason,
			...(proof ? { proof } : {}),
		});
	}
	return {
		protocol: controlCancellationPolicy.protocol,
		policy: controlCancellationPolicy,
		scope,
		rawFailedRequests: failures.length,
		realFailures,
		unknownFailures,
		provenControls,
		complete,
		coverage: { ...coverage },
		records,
	};
}

/** Serialized receipts do not default missing counts/coverage to a successful zero. */
export function cleanBrowserFailureEvidence(evidence, rawFailedRequests) {
	if (
		!evidence ||
		evidence.protocol !== controlCancellationPolicy.protocol ||
		JSON.stringify(evidence.policy) !==
			JSON.stringify(controlCancellationPolicy) ||
		evidence.scope !== "measured" ||
		evidence.complete !== true ||
		!Number.isSafeInteger(rawFailedRequests) ||
		rawFailedRequests < 0 ||
		evidence.rawFailedRequests !== rawFailedRequests ||
		["realFailures", "unknownFailures", "provenControls"].some(
			(key) => !Number.isSafeInteger(evidence[key]) || evidence[key] < 0,
		) ||
		evidence.realFailures !== 0 ||
		evidence.unknownFailures !== 0 ||
		evidence.rawFailedRequests !==
			evidence.realFailures +
				evidence.unknownFailures +
				evidence.provenControls ||
		!Array.isArray(evidence.records) ||
		evidence.records.length !== rawFailedRequests ||
		new Set(evidence.records.map((row) => row.requestId)).size !==
			rawFailedRequests ||
		evidence.records.some(
			(row) =>
				!row.requestId ||
				row.outcome !== "protocol-control" ||
				![
					"complete-cached-flight-native-revalidation",
					"completed-flight-late-terminal-cancel",
				].includes(row.reason),
		)
	)
		return false;
	for (const row of evidence.records) {
		const proof = row.proof;
		if (
			!proof ||
			proof.proxyCandidates !== 1 ||
			proof.failure?.requestId !== row.requestId ||
			(row.reason === "complete-cached-flight-native-revalidation" &&
				proof.cachedCandidates !== 1)
		)
			return false;
		const verified = classifyControlCancellations({
			failures: [proof.failure],
			proxy: [proof.packet],
			responses: proof.cached ? [proof.cached] : [],
			browserRevision: proof.browserRevision,
			coverage: evidence.coverage,
		});
		if (
			verified.provenControls !== 1 ||
			verified.records[0].reason !== row.reason
		)
			return false;
	}
	return (
		evidence.coverage?.installed === true &&
		evidence.coverage.scopeClosed === true &&
		["missing", "overflow", "errors", "pendingBodies"].every(
			(key) => evidence.coverage[key] === 0,
		)
	);
}
