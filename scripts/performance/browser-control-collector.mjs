/** Passive all-phase identity/body receipts. No app requests, payloads, URLs or header values are emitted. */
import { createHash } from "node:crypto";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import {
	classifyControlCancellations,
	controlCancellationPolicy,
	inspectRequiredFlightBody,
} from "./control-cancellation-evidence.mjs";

export const controlResponseHeader = "x-z8-fixture-response-id";
export const controlDocumentHeader = "x-z8-fixture-document-generation";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const selectedHeaders = [
	"rsc",
	"next-router-prefetch",
	"next-router-segment-prefetch",
	"next-router-state-tree",
	"next-action",
	"accept",
	"accept-language",
	controlDocumentHeader,
];
const lowerHeaders = (headers = {}) =>
	Object.fromEntries(
		Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
	);
export function controlRequestIdentity(contextId, url, method, headers) {
	const h = lowerHeaders(headers);
	const action = h["next-action"] !== undefined;
	const requestKind = action
		? "action"
		: h["next-router-segment-prefetch"] === undefined
			? "navigation"
			: h["next-router-segment-prefetch"] === "/_tree"
				? "route-tree"
				: "segment-prefetch";
	return {
		contextId,
		method,
		fullUrlSha256: sha(url),
		requestHeadersSha256: sha(
			JSON.stringify(selectedHeaders.map((key) => [key, h[key] ?? null])),
		),
		documentGeneration: h[controlDocumentHeader] ?? null,
		action,
		requestKind,
		prefetch: h["next-router-prefetch"] === "1",
		flight: h.rsc === "1",
	};
}
export function controlResponseMetadata(headers, status) {
	const h = lowerHeaders(headers);
	const swr = /(?:^|,)\s*stale-while-revalidate\s*=\s*(\d+)\s*(?:,|$)/i.exec(
		h["cache-control"] ?? "",
	);
	const seconds = swr ? Number(swr[1]) : null;
	return {
		status,
		flight: /^text\/x-component(?:;|$)/i.test(h["content-type"] ?? ""),
		staleWhileRevalidateSeconds: Number.isSafeInteger(seconds) ? seconds : null,
		proxyResponseId: /^[a-f0-9]{32}\.[1-9]\d{0,9}$/.test(
			h[controlResponseHeader] ?? "",
		)
			? h[controlResponseHeader]
			: null,
	};
}

/** readBody is the existing session's Network.getResponseBody; proxyRecords is owned transport data. */
export function createBrowserControlCollector({
	contextId,
	origin,
	browserRevision,
	compiledCachedNavigations,
	readBody,
	readStream,
	proxyObservation = () => ({
		rows: [],
		installed: false,
		errors: 0,
		overflow: 0,
	}),
}) {
	const requests = new Map(),
		extra = new Map(),
		pending = new Set(),
		queue = [],
		measuredFailureIds = [];
	let installed = false,
		measurementStarted = false,
		measurementClosed = false,
		closed = false,
		errors = 0,
		overflow = 0,
		missing = 0,
		retained = 0,
		streamRetained = 0;
	const limited = () =>
		requests.size + extra.size >= controlCancellationPolicy.recordLimit;
	const rows = () => [...requests.values()];
	const processBodies = () => {
		while (
			pending.size < 1 &&
			queue.length &&
			retained + controlCancellationPolicy.decodedLimit <=
				controlCancellationPolicy.retainedLimit
		) {
			const row = queue.shift();
			retained += controlCancellationPolicy.decodedLimit;
			const task = Promise.resolve().then(async () => {
				try {
					const result = await readBody(row.requestId);
					if (
						typeof result?.body !== "string" ||
						typeof result.base64Encoded !== "boolean"
					) {
						row.bodyProof = { complete: false, reason: "invalid-cdp-body" };
						return;
					}
					if (
						result.base64Encoded &&
						!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
							result.body,
						)
					) {
						row.bodyProof = { complete: false, reason: "invalid-cdp-body" };
						return;
					}
					const upper = result.base64Encoded
						? Math.ceil((result.body.length * 3) / 4)
						: Buffer.byteLength(result.body);
					if (upper > controlCancellationPolicy.decodedLimit) {
						row.bodyProof = { complete: false, reason: "body-limit" };
						return;
					}
					const bytes = Buffer.from(
						result.body,
						result.base64Encoded ? "base64" : "utf8",
					);
					row.bodyProof = inspectRequiredFlightBody(bytes, {
						action: row.action,
						cachedNavigations: compiledCachedNavigations,
						requestKind: row.requestKind,
					});
					row.bodyReadbackComplete = true;
				} catch {
					if (!row.streamReceipt?.captureComplete)
						row.bodyProof = { complete: false, reason: "cdp-body-unavailable" };
				} finally {
					retained -= controlCancellationPolicy.decodedLimit;
					pending.delete(task);
					processBodies();
				}
			});
			pending.add(task);
		}
	};
	const finishStream = (row) => {
		const stream = row.stream;
		if (!stream?.terminal || !stream.acknowledged || stream.finalized) return;
		stream.finalized = true;
		const captureComplete = !stream.reason && stream.bytes === stream.observed;
		row.streamReceipt = {
			protocol: "passive-network-copy-v1",
			sourceRevision: browserRevision,
			captureComplete,
			terminal: stream.terminal,
			capturedBytes: stream.bytes,
			observedDataLength: stream.observed,
			reason: stream.reason ?? (captureComplete ? null : "byte-coverage-gap"),
		};
		if (captureComplete && !row.bodyReadbackComplete)
			row.bodyProof = inspectRequiredFlightBody(Buffer.concat(stream.chunks), {
				action: row.action,
				cachedNavigations: compiledCachedNavigations,
				requestKind: row.requestKind,
			});
		retained -= stream.bytes;
		streamRetained -= stream.bytes;
		stream.chunks = [];
		processBodies();
	};
	const appendStream = (row, encoded, prefix = false) => {
		const stream = row.stream;
		if (!stream || stream.reason || stream.finalized) return;
		if (
			typeof encoded !== "string" ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
				encoded,
			)
		) {
			stream.reason = "invalid-stream-data";
			return;
		}
		const upper = Math.ceil((encoded.length * 3) / 4);
		if (
			stream.bytes + upper > controlCancellationPolicy.decodedLimit ||
			retained + upper > controlCancellationPolicy.retainedLimit ||
			streamRetained + upper >
				controlCancellationPolicy.retainedLimit -
					controlCancellationPolicy.decodedLimit
		) {
			stream.reason = "body-limit";
			return;
		}
		const bytes = Buffer.from(encoded, "base64");
		if (prefix) stream.chunks.unshift(bytes);
		else stream.chunks.push(bytes);
		stream.bytes += bytes.length;
		retained += bytes.length;
		streamRetained += bytes.length;
	};
	const startStream = (row) => {
		if (
			!readStream ||
			row.stream ||
			row.type === "Other" ||
			row.fromDiskCache ||
			!row.applicationOrigin ||
			(!row.flight && !row.action)
		)
			return;
		row.stream = {
			acknowledged: false,
			bytes: 0,
			observed: row.observedDataLength ?? 0,
			chunks: [],
			terminal: null,
			finalized: false,
		};
		Promise.resolve()
			.then(() => readStream(row.requestId))
			.then(
				(result) => {
					appendStream(row, result?.bufferedData, true);
					row.stream.acknowledged = true;
					finishStream(row);
				},
				() => {
					row.stream.reason = "stream-command-unavailable";
					row.stream.acknowledged = true;
					finishStream(row);
				},
			);
	};
	const read = (row) => {
		if (
			!row.applicationOrigin ||
			(!row.flight && !row.action) ||
			row.bodyRequested
		)
			return;
		row.bodyRequested = true;
		queue.push(row);
		processBodies();
	};
	const headerIdentity = (headers) => {
		const { fullUrlSha256, method, ...identity } = controlRequestIdentity(
			contextId,
			"",
			"",
			headers,
		);
		return identity;
	};
	const applyExtra = (row, identity) => {
		Object.assign(row, identity);
		row.requestHeadersKnown = true;
	};
	const snapshot = () => {
		const failures = rows().filter((row) => row.failed),
			responses = rows().filter((row) => row.loadingFinished);
		const proxy = proxyObservation();
		const coverage = {
			installed: installed && proxy.installed === true,
			scopeClosed: closed,
			errors: errors + proxy.errors,
			overflow: overflow + proxy.overflow,
			missing:
				missing + failures.filter((row) => !row.requestHeadersKnown).length,
			pendingBodies: pending.size + queue.length + proxy.pendingBodies,
		};
		const data = { responses, proxy: proxy.rows, coverage, browserRevision };
		const measuredRows = measuredFailureIds.map((id) =>
			requests.get(id)?.failed
				? requests.get(id)
				: { contextId, requestId: id },
		);
		const measuredCoverage = {
			...coverage,
			installed: coverage.installed && measurementStarted,
			scopeClosed: coverage.scopeClosed && measurementClosed,
			missing:
				coverage.missing + measuredRows.filter((row) => !row.failed).length,
		};
		return {
			measured: classifyControlCancellations({
				...data,
				coverage: measuredCoverage,
				failures: measuredRows,
			}),
			allPhase: classifyControlCancellations({
				...data,
				failures,
				scope: "all-phase-semantic-correlation",
			}),
			// Technical body availability remains distinct from positive protocol completion.
			bodyReceipts: rows()
				.filter((row) => row.bodyRequested || row.streamReceipt)
				.map((row) => ({
					requestId: row.requestId,
					loadingFinished: row.loadingFinished === true,
					failed: row.failed === true,
					action: row.action,
					bodyReadbackComplete: row.bodyReadbackComplete === true,
					streamReceipt: row.streamReceipt ?? null,
					bodyProof: row.bodyProof ?? null,
				})),
		};
	};
	return {
		installed() {
			installed = true;
		},
		beginMeasurement() {
			if (measurementStarted) errors++;
			measurementStarted = true;
		},
		endMeasurement() {
			measurementClosed = measurementStarted;
		},
		recordMeasuredFailure(requestId) {
			if (!measurementStarted || measurementClosed) errors++;
			if (measuredFailureIds.length >= controlCancellationPolicy.recordLimit) {
				overflow++;
				return;
			}
			// Called ONLY at the existing raw failedRequests increment; no cross-session timing inference.
			measuredFailureIds.push(requestId);
		},
		endScope() {
			closed = true;
			for (const row of rows())
				if (row.stream && !row.stream.finalized) {
					row.stream.finalized = true;
					row.streamReceipt = {
						protocol: "passive-network-copy-v1",
						sourceRevision: browserRevision,
						captureComplete: false,
						terminal: "scope-ended",
						capturedBytes: row.stream.bytes,
						observedDataLength: row.stream.observed,
						reason: "scope-ended-before-terminal",
					};
					retained -= row.stream.bytes;
					streamRetained -= row.stream.bytes;
					row.stream.chunks = [];
				}
		},
		observerError() {
			errors++;
		},
		request(event) {
			if (limited()) {
				overflow++;
				return;
			}
			const previous = requests.get(event.requestId);
			if (previous && !event.redirectResponse) {
				missing++;
				return;
			}
			const row = {
				...controlRequestIdentity(
					contextId,
					event.request.url,
					event.request.method,
					event.request.headers,
				),
				requestId: event.requestId,
				loaderId: event.loaderId,
				startedAt: event.timestamp,
				type: event.type,
				priority: event.request.initialPriority,
				initiator: event.initiator?.type,
				initiatorStackKnownAbsent:
					event.initiator?.type === "other" &&
					event.initiator.stack === undefined,
				applicationOrigin: new URL(event.request.url).origin === origin,
				ambiguousRedirect: previous !== undefined,
			};
			requests.set(event.requestId, row);
			if (extra.has(event.requestId)) {
				applyExtra(row, extra.get(event.requestId));
				extra.delete(event.requestId);
			}
		},
		requestExtra(event) {
			const row = requests.get(event.requestId);
			if (row) applyExtra(row, headerIdentity(event.headers));
			else if (!limited())
				extra.set(event.requestId, headerIdentity(event.headers));
			else overflow++;
		},
		response(event) {
			const row = requests.get(event.requestId);
			if (!row) {
				missing++;
				return;
			}
			Object.assign(
				row,
				controlResponseMetadata(event.response.headers, event.response.status),
				{
					fromDiskCache: event.response.fromDiskCache === true,
					fromServiceWorker: event.response.fromServiceWorker === true,
				},
			);
			startStream(row);
		},
		responseExtra(event) {
			const row = requests.get(event.requestId);
			if (!row) {
				missing++;
				return;
			}
			const metadata = controlResponseMetadata(event.headers, event.statusCode);
			if (row.status !== undefined) metadata.status = row.status;
			Object.assign(row, metadata, {
				httpErrorObserved: event.statusCode >= 400,
			});
		},
		finished(event) {
			const row = requests.get(event.requestId);
			if (!row) {
				missing++;
				return;
			}
			row.loadingFinished = true;
			row.failed ??= false;
			row.finishedAt = event.timestamp;
			if (row.stream) {
				row.stream.terminal = "finished";
				finishStream(row);
			}
			if (row.fromDiskCache) read(row);
		},
		failed(event) {
			const row = requests.get(event.requestId);
			if (!row) {
				missing++;
				return;
			}
			if (row.failed) {
				errors++;
				return;
			}
			row.failed = true;
			row.error = event.errorText;
			row.canceled = event.canceled === true;
			if (row.stream) {
				row.stream.terminal = "failed";
				finishStream(row);
			}
			read(row);
		},
		data(event) {
			const row = requests.get(event.requestId);
			if (!row) {
				missing++;
				return;
			}
			if (!Number.isSafeInteger(event.dataLength) || event.dataLength < 0) {
				if (row.stream) row.stream.reason = "invalid-data-length";
				return;
			}
			row.observedDataLength = (row.observedDataLength ?? 0) + event.dataLength;
			if (row.stream) {
				if (row.stream.finalized) {
					row.streamReceipt.captureComplete = false;
					row.streamReceipt.reason = "data-after-terminal";
					return;
				}
				row.stream.observed += event.dataLength;
				if (event.data !== undefined) appendStream(row, event.data);
			}
		},
		snapshot,
	};
}

/** Optional prospective installation; callers retain their normal measurement boundaries. */
export async function installBrowserControlCollector({
	page,
	transport,
	origin,
	headers,
	contextId,
	browserRevision,
	compiledCachedNavigations,
}) {
	const session = await page.createCDPSession();
	const proxy = createProxyControlCollector({
		contextId,
		compiledCachedNavigations,
	});
	const transportErrors = transport.setControlCancellationObserver(proxy);
	const proxyObservation = () => {
		const proof = proxy.snapshot();
		return { ...proof, errors: proof.errors + transportErrors() };
	};
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		browserRevision,
		compiledCachedNavigations,
		proxyObservation,
		readBody: (requestId) =>
			session.send("Network.getResponseBody", { requestId }),
		readStream: (requestId) =>
			session.send("Network.streamResourceContent", { requestId }),
	});
	const events = {
		requestWillBeSent: "request",
		requestWillBeSentExtraInfo: "requestExtra",
		responseReceived: "response",
		responseReceivedExtraInfo: "responseExtra",
		loadingFinished: "finished",
		loadingFailed: "failed",
		dataReceived: "data",
	};
	for (const [event, name] of Object.entries(events))
		session.on(`Network.${event}`, (value) => {
			try {
				collector[name](value);
			} catch {
				collector.observerError();
			}
		});
	await session.send("Network.enable");
	let generation = 0;
	const originals = new Map();
	for (const method of ["goto", "reload", "goBack"]) {
		const original = page[method];
		originals.set(method, original);
		page[method] = async function (...args) {
			// This declared technical header is observed on both HTTP and CDP, never inferred from timing.
			await session.send("Network.setExtraHTTPHeaders", {
				headers: {
					...headers,
					[controlDocumentHeader]: `${contextId}:${++generation}`,
				},
			});
			return Reflect.apply(original, this, args);
		};
	}
	collector.installed();
	return {
		...collector,
		async close() {
			collector.endScope();
			for (const [method, original] of originals) page[method] = original;
			await session.detach();
		},
	};
}

/** Same actual bytes as forwarding; no replay, clone, response hold, or public payload retention. */
export function createProxyControlCollector({
	contextId,
	compiledCachedNavigations,
}) {
	const requests = new Map();
	let installed = false,
		retained = 0,
		errors = 0,
		overflow = 0,
		pendingBodies = 0;
	const release = (row) => {
		retained -= row.retainedBytes;
		row.retainedBytes = 0;
		row.chunks = [];
	};
	return {
		installed() {
			installed = true;
		},
		observerError() {
			errors++;
		},
		request(id, { url, method, headers, traceId }) {
			if (
				requests.size >= controlCancellationPolicy.recordLimit ||
				requests.has(id)
			) {
				overflow++;
				return;
			}
			requests.set(id, {
				...controlRequestIdentity(contextId, url, method, headers),
				id,
				traceId,
				upstreamError: false,
				canceled: false,
				complete: false,
				chunks: [],
				retainedBytes: 0,
			});
		},
		response(id, { status, headers }) {
			const row = requests.get(id);
			if (!row) {
				errors++;
				return;
			}
			Object.assign(row, controlResponseMetadata(headers, status));
			row.encoding = lowerHeaders(headers)["content-encoding"] ?? "identity";
		},
		bytes(id, chunk) {
			const row = requests.get(id);
			if (!row || row.canceled || row.complete) return;
			if (!row.flight && !row.action) return;
			if (
				row.bounded ||
				row.retainedBytes + chunk.length >
					controlCancellationPolicy.encodedLimit ||
				retained + chunk.length > controlCancellationPolicy.retainedLimit
			) {
				if (!row.bounded) {
					overflow++;
					row.bounded = true;
					release(row);
				}
				return;
			}
			row.chunks.push(chunk);
			row.retainedBytes += chunk.length;
			retained += chunk.length;
		},
		end(id) {
			const row = requests.get(id);
			if (!row || row.canceled || row.complete) return;
			row.complete = true;
			pendingBodies++;
			// Do not hold response forwarding/EOF open for proof parsing.
			setImmediate(() => {
				try {
					if ((!row.flight && !row.action) || row.bounded) return;
					let bytes = Buffer.concat(row.chunks);
					const options = {
						maxOutputLength: controlCancellationPolicy.decodedLimit,
					};
					if (row.encoding === "gzip") bytes = gunzipSync(bytes, options);
					else if (row.encoding === "br")
						bytes = brotliDecompressSync(bytes, options);
					else if (row.encoding === "deflate")
						bytes = inflateSync(bytes, options);
					else if (!["", "identity"].includes(row.encoding))
						throw Error("Unsupported encoding");
					row.bodyProof = inspectRequiredFlightBody(bytes, {
						action: row.action,
						cachedNavigations: compiledCachedNavigations,
						requestKind: row.requestKind,
					});
				} catch {
					row.bodyProof = { complete: false, reason: "proxy-body-unavailable" };
				} finally {
					release(row);
					pendingBodies--;
				}
			});
		},
		cancel(id) {
			const row = requests.get(id);
			if (!row || row.complete) return;
			row.canceled = true;
			release(row);
		},
		failure(id) {
			const row = requests.get(id);
			if (!row) {
				errors++;
				return;
			}
			row.upstreamError = true;
			release(row);
		},
		snapshot() {
			return {
				installed,
				errors,
				overflow,
				pendingBodies,
				rows: [...requests.values()].map(
					({ chunks, retainedBytes, encoding, ...proof }) => ({ ...proof }),
				),
			};
		},
	};
}
