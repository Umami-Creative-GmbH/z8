/** Passive all-phase identity/body receipts. No app requests, payloads, URLs or header values are emitted. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import {
	classifyControlCancellations,
	controlCancellationPolicy,
	inspectRequiredFlightBody,
	knownBrowserControlMetadata,
} from "./control-cancellation-evidence.mjs";

export const controlResponseHeader = "x-z8-fixture-response-id";
export const controlDocumentHeader = "x-z8-fixture-document-generation";
export const mixedBrowserWorkScope = "all-mixed-context-work-before-first-app-io-through-finite-settlement-v1";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const shaChunks = (chunks) => {
	const hash = createHash("sha256");
	for (const chunk of chunks) hash.update(chunk);
	return hash.digest("hex");
};
const hasProtocolError = (proof) => proof?.serverErrors > 0 || proof?.explicitActionFailure === true;
const protocolErrorFact = (proof, capture, bodySha256) => ({
	capture,
	serverErrors: Number.isSafeInteger(proof.serverErrors) && proof.serverErrors > 0 ? proof.serverErrors : 0,
	explicitActionFailure: proof.explicitActionFailure === true,
	reason: ["flight-server-error", "embedded-runtime-prefetch-incomplete", "explicit-root-action-failure"].includes(proof.reason) ? proof.reason : "observed-protocol-error",
	bodySha256: /^[a-f0-9]{64}$/.test(bodySha256 ?? "") ? bodySha256 : null,
});
const assignBodyProof = (row, proof, capture, bodySha256) => {
	row.bodyProof = proof;
	if (!hasProtocolError(proof)) return;
	const fact = protocolErrorFact(proof, capture, bodySha256);
	row.observedProtocolError = { serverErrors: Math.max(row.observedProtocolError?.serverErrors ?? 0, fact.serverErrors),
		explicitActionFailure: row.observedProtocolError?.explicitActionFailure === true || fact.explicitActionFailure };
	const history = row.protocolErrorObservations ??= [];
	if (history.some((prior) => JSON.stringify(prior) === JSON.stringify(fact))) return;
	if (history.length >= 2) { row.protocolErrorObservationOverflow = (row.protocolErrorObservationOverflow ?? 0) + 1; return; }
	history.push(fact);
};

/** Read the compiled source boundary before app/control/browser IO; never infer a missing flag. */
export async function readBrowserControlBinding({ plan, manifestPath }) {
	const metadata = plan.runtime?.browserControl;
	if (!knownBrowserControlMetadata(metadata) || !/^[a-f0-9]{40}$/.test(plan.runtime?.build ?? "") || !manifestPath)
		throw Error("Missing qualified browser control runtime metadata or app manifest.");
	const bytes = await readFile(manifestPath);
	let manifest;
	try { manifest = JSON.parse(bytes.toString("utf8")); }
	catch { throw Error("Compiled app manifest is unavailable or malformed."); }
	if (sha(bytes) !== metadata.compiledManifestSha256 || manifest.config?.deploymentId !== plan.runtime.build ||
		typeof manifest.config?.experimental?.cachedNavigations !== "boolean" ||
		manifest.config.experimental.cachedNavigations !== metadata.compiledCachedNavigations)
		throw Error("Compiled app manifest differs from the qualified browser control metadata.");
	return Object.freeze({ ...metadata, compiledBuild: plan.runtime.build, manifestVerified: true, browserVerified: false });
}

/** One actual startup command, before visits; no app requests and no browser-revision default. */
export async function verifyBrowserControlBrowser(browser, binding) {
	if (!knownBrowserControlMetadata(binding) || binding.manifestVerified !== true)
		throw Error("Browser control manifest admission is missing.");
	const session = await browser.target().createCDPSession();
	try {
		const actual = await session.send("Browser.getVersion");
		if (actual.revision?.replace(/^@/, "") !== binding.browserRevision)
			throw Error("Actual browser revision differs from qualified protocol control source.");
		return Object.freeze({ ...binding, browserVerified: true });
	} finally { await session.detach(); }
}
const selectedHeaders = [
	"rsc",
	"next-router-prefetch",
	"next-router-segment-prefetch",
	"next-router-state-tree",
	"next-url",
	"next-action",
	"accept",
	"accept-encoding",
	"accept-language",
	"cookie",
	"authorization",
	controlDocumentHeader,
];
const lowerHeaders = (headers = {}) =>
	Object.fromEntries(
		Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
	);

/** Cookie values live only in the actual browser snapshot and temporary hashing input. */
export function createPrincipalEpochObserver(contextId) {
	let before, after, scopeClosed = false, readErrors = 0, pendingReads = 0, observationErrors = 0, overflow = 0, unknownResponseHeaders = 0;
	const setCookies = new Map();
	const unknown = () => ({ known: false, cookieCount: null, sha256: null });
	const snapshotCookies = (cookies) => {
		if (!Array.isArray(cookies) || cookies.length > controlCancellationPolicy.recordLimit || cookies.some((cookie) =>
			!cookie || ["name", "domain", "path", "value"].some((key) => typeof cookie[key] !== "string") || cookie.partitionKey !== undefined)) return unknown();
		const rows = cookies.map(({ name, domain, path, value }) => [name, domain, path, value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
		if (new Set(rows.map((row) => JSON.stringify(row.slice(0, 3)))).size !== rows.length) return unknown();
		const bytes = JSON.stringify(rows);
		if (Buffer.byteLength(bytes) > controlCancellationPolicy.encodedLimit) return unknown();
		return { known: true, cookieCount: rows.length, sha256: sha(bytes) };
	};
	return {
		readStarted() { pendingReads++; },
		readFinished() { pendingReads--; },
		start(cookies) {
			if (before) { observationErrors++; return; }
			before = snapshotCookies(cookies);
		},
		end(cookies) {
			if (scopeClosed) { observationErrors++; return; }
			after = snapshotCookies(cookies); scopeClosed = true;
		},
		readFailure(stage) {
			readErrors++;
			if (stage === "start" && !before) before = unknown();
			else if (stage === "end" && !scopeClosed) { after = unknown(); scopeClosed = true; }
			else observationErrors++;
		},
		response(requestId, headers) {
			if (!headers || typeof headers !== "object" || Array.isArray(headers)) { unknownResponseHeaders++; return; }
			const value = lowerHeaders(headers)["set-cookie"];
			if (value === undefined) return;
			if (typeof requestId !== "string" || setCookies.size >= controlCancellationPolicy.recordLimit) { overflow++; return; }
			const digest = sha(value);
			if (setCookies.has(requestId) && setCookies.get(requestId) !== digest) observationErrors++;
			setCookies.set(requestId, digest);
		},
		snapshot() {
			const actualBefore = before ?? unknown(), actualAfter = after ?? unknown();
			return { protocol: "actual-browser-cookie-boundaries-v1", contextId, before: { ...actualBefore }, after: { ...actualAfter },
				matchesAtBoundaries: actualBefore.known && actualAfter.known ? actualBefore.sha256 === actualAfter.sha256 : null,
				scopeClosed, observedSetCookieResponses: setCookies.size, unknownResponseHeaders, readErrors, pendingReads, observationErrors, overflow,
				stablePrincipalClaim: false };
		},
	};
}

/** A metadata read only: never waits past the caller's existing off-critical deadline. */
export async function capturePrincipalBoundary({ context, observer, stage, deadlineMs }) {
	const remaining = deadlineMs - performance.now();
	if (!["start", "end"].includes(stage) || !Number.isFinite(remaining) || remaining <= 0 || remaining > 10000 || typeof context?.cookies !== "function") {
		observer.readFailure(stage); return;
	}
	let timer;
	observer.readStarted();
	const actual = Promise.resolve().then(() => context.cookies()).finally(() => observer.readFinished());
	try {
		const cookies = await Promise.race([actual, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Cookie metadata deadline elapsed.")), remaining); })]);
		observer[stage](cookies);
	} catch { observer.readFailure(stage); }
	finally { clearTimeout(timer); }
}
export function controlRequestIdentity(contextId, url, method, headers) {
	const h = lowerHeaders(headers);
	const action = h["next-action"] !== undefined;
	const requestKind = action
		? "action"
		: h["next-router-segment-prefetch"] === undefined
			? h["rsc"] === "1" && h["next-router-prefetch"] === "3" ? "runtime-shell" : "navigation"
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
		// Diagnostic comparison only: full browser/proxy identity still includes this token.
		withoutTechnicalDocumentSha256: sha(
			JSON.stringify(
				selectedHeaders
					.filter((key) => key !== controlDocumentHeader)
					.map((key) => [key, h[key] ?? null]),
			),
		),
		headerFieldSha256: Object.fromEntries(
			selectedHeaders.map((key) => [
				key,
				h[key] === undefined ? null : sha(h[key]),
			]),
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
	const varyValue = h.vary;
	const boundedVary = headers !== undefined && headers !== null && typeof headers === "object" && !Array.isArray(headers) &&
		(varyValue === undefined || varyValue.length <= 1024);
	const varyFields = boundedVary && varyValue !== undefined ? varyValue.split(",").map((field) => field.trim().toLowerCase()) : [];
	const unknownVaryFields = varyFields.filter((field) => !selectedHeaders.includes(field));
	const vary = { known: boundedVary && unknownVaryFields.length === 0,
		fields: [...new Set(varyFields.filter((field) => selectedHeaders.includes(field)))].sort(),
		star: varyFields.includes("*"), unknownFields: boundedVary ? unknownVaryFields.length : null };
	const swr = /(?:^|,)\s*stale-while-revalidate\s*=\s*(\d+)\s*(?:,|$)/i.exec(
		h["cache-control"] ?? "",
	);
	const seconds = swr ? Number(swr[1]) : null;
	return {
		status,
		vary,
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
	captureContextFailures = false,
	principalEpoch = createPrincipalEpochObserver(contextId),
	proxyObservation = () => ({
		rows: [],
		installed: false,
		errors: 0,
		overflow: 0,
	}),
}) {
	const requests = new Map(),
		extra = new Map(),
		responseExtras = new Map(),
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
		streamRetained = 0,
		joinedResponseExtras = 0,
		rawMeasuredFailedRequests = 0;
	const limited = () =>
		requests.size + extra.size + responseExtras.size >=
		controlCancellationPolicy.recordLimit;
	const rows = () => [...requests.values()];
	const recordMeasuredFailure = (requestId) => {
		rawMeasuredFailedRequests++;
		if (!measurementStarted || measurementClosed) errors++;
		if (measuredFailureIds.length >= controlCancellationPolicy.recordLimit) { overflow++; return; }
		measuredFailureIds.push(requestId);
	};
	const missingFamilies = {
		duplicateRequest: 0,
		responseBeforeRequest: 0,
		responseExtraBeforeRequest: 0,
		dataBeforeRequest: 0,
		finishedBeforeRequest: 0,
		failedBeforeRequest: 0,
	};
	const missingEvent = (family) => {
		missing++;
		missingFamilies[family]++;
	};
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
					row.bodyReadbackReceipt = { available: true, decodedBytes: bytes.length, bodySha256: sha(bytes),
						terminal: row.failed ? "failed" : row.loadingFinished ? "finished" : "pending", naturalEOFClaim: false };
					assignBodyProof(row, inspectRequiredFlightBody(bytes, {
						action: row.action,
						cachedNavigations: compiledCachedNavigations,
						requestKind: row.requestKind,
					}), "cdp-readback", row.bodyReadbackReceipt.bodySha256);
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
			byteCoverageExact: captureComplete,
			terminal: stream.terminal,
			capturedBytes: stream.bytes,
			capturedBodySha256: shaChunks(stream.chunks),
			observedDataLength: stream.observed,
			reason: stream.reason ?? (captureComplete ? null : "byte-coverage-gap"),
		};
		if (captureComplete)
			assignBodyProof(row, inspectRequiredFlightBody(Buffer.concat(stream.chunks), {
				action: row.action,
				cachedNavigations: compiledCachedNavigations,
				requestKind: row.requestKind,
			}), "passive-stream", row.streamReceipt.capturedBodySha256);
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
		row.extraHeaderIdentity = identity;
		Object.assign(row, identity);
		row.requestHeadersKnown = true;
	};
	const applyResponseExtra = (row, metadata) => {
		row.extraResponseVary = metadata.vary;
		if (row.status !== undefined)
			metadata = { ...metadata, status: row.status };
		Object.assign(row, metadata, { vary: row.initialResponseVary ?? metadata.vary });
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
			// ExtraInfo is optional by CDP contract, not an event-loss census.
			// Missing positive request identity still leaves that failure UNKNOWN.
			missing: missing + responseExtras.size,
			optionalRequestExtraInfoAbsent: failures.filter(
				(row) => !row.requestHeadersKnown,
			).length,
			pendingBodies: pending.size + queue.length + proxy.pendingBodies,
		};
		const data = { responses, proxy: proxy.rows, coverage, browserRevision };
		const sources = [...rows().map((row) => ({ source: "browser", row })), ...proxy.rows.map((row) => ({ source: "proxy", row }))];
		const protocolErrorRecords = sources.flatMap(({ source, row }) => {
			const history = row.protocolErrorObservations ?? (hasProtocolError(row.bodyProof) ? [protocolErrorFact(row.bodyProof, "latest-proof",
				row.transportBodyReceipt?.bodySha256 ?? row.bodyReadbackReceipt?.bodySha256 ?? row.streamReceipt?.capturedBodySha256)] : []);
			return history.map((fact) => ({ source, contextId: row.contextId, requestId: row.requestId ?? row.id,
				proxyResponseId: row.proxyResponseId ?? (source === "proxy" ? row.id : null), ...fact }));
		});
		const protocolErrorOverflow = sources.reduce((total, { row }) => total + (row.protocolErrorObservationOverflow ?? 0), 0);
		const measuredRows = measuredFailureIds.map((id) =>
			requests.get(id)?.failed
				? requests.get(id)
				: { contextId, requestId: id },
		);
		const measuredCoverage = {
			...coverage,
			installed: coverage.installed && measurementStarted,
			scopeClosed: coverage.scopeClosed && measurementClosed,
			optionalRequestExtraInfoAbsent: measuredRows.filter(
				(row) => row.failed && !row.requestHeadersKnown,
			).length,
			missing:
				coverage.missing + measuredRows.filter((row) => !row.failed).length,
		};
		const headerProvenance = (row) => ({
			documentGeneration: row.documentGeneration,
			requestHeadersSha256: row.requestHeadersSha256,
			withoutTechnicalDocumentSha256: row.withoutTechnicalDocumentSha256,
			headerFieldSha256: row.headerFieldSha256,
		});
		return {
			contextId,
			protocolErrors: { protocol: "positive-flight-error-observations-v1", contextId, installed: coverage.installed, scopeClosed: closed,
				observed: protocolErrorRecords.length, overflow: protocolErrorOverflow + Math.max(0, protocolErrorRecords.length - controlCancellationPolicy.recordLimit),
				records: protocolErrorRecords.slice(0, controlCancellationPolicy.recordLimit) },
			principalEpoch: principalEpoch.snapshot(),
			rawMeasuredFailedRequests,
			diagnostics: {
				earlyResponseExtra: {
					joined: joinedResponseExtras,
					orphan: responseExtras.size,
				},
				missingFamilies: {
					...missingFamilies,
					responseExtraBeforeRequest:
						missingFamilies.responseExtraBeforeRequest + responseExtras.size,
					failedRequestHeadersUnknown: failures.filter(
						(row) => !row.requestHeadersKnown,
					).length,
					measuredFailureNotObserved: measuredRows.filter((row) => !row.failed)
						.length,
				},
				failures: failures.map((row) => {
					const candidates = proxy.rows.filter(
						(candidate) =>
							candidate.contextId === row.contextId &&
							candidate.method === row.method &&
							candidate.fullUrlSha256 === row.fullUrlSha256,
					);
					const cached = responses.filter(
						(candidate) =>
							candidate.fromDiskCache &&
							candidate.fullUrlSha256 === row.fullUrlSha256 &&
							candidate.method === row.method,
					);
					const selectedPackets = row.proxyResponseId
						? candidates.filter(
								(candidate) => candidate.id === row.proxyResponseId,
							)
						: candidates;
					return {
						requestId: row.requestId,
						type: row.type,
						method: row.method,
						requestKind: row.requestKind,
						action: row.action,
						flight: row.flight,
						prefetch: row.prefetch,
						status: row.status ?? null,
						requestHeadersKnown: row.requestHeadersKnown === true,
						vary: row.vary ?? null,
						initialResponseVary: row.initialResponseVary ?? null,
						extraResponseVary: row.extraResponseVary ?? null,
						headerKnowledgeSource:
							row.requestHeadersKnown === true
								? "request-extra-info"
								: "initial-event-only",
						initialHeaderIdentity: row.initialHeaderIdentity
							? headerProvenance(row.initialHeaderIdentity)
							: null,
						extraHeaderIdentity: row.extraHeaderIdentity
							? headerProvenance(row.extraHeaderIdentity)
							: null,
						documentGeneration: row.documentGeneration,
						fullUrlSha256: row.fullUrlSha256,
						requestHeadersSha256: row.requestHeadersSha256,
						proxyResponseId: row.proxyResponseId ?? null,
						fromDiskCache: row.fromDiskCache === true,
						loaderId: row.loaderId,
						cachedCandidates: {
							selected: cached.slice(0, 8).map((candidate) => ({
								requestId: candidate.requestId,
								loaderId: candidate.loaderId,
								...headerProvenance(candidate),
								bodyProofReason: candidate.bodyProof?.reason ?? null,
								bodyComplete: candidate.bodyProof?.complete === true,
								proxyResponseId: candidate.proxyResponseId ?? null,
								vary: candidate.vary ?? null,
								bodyReadbackReceipt: candidate.bodyReadbackReceipt ?? null,
							})),
							selectedTruncated: cached.length > 8,
							sameUrlMethod: cached.length,
							sameLoader: cached.filter(
								(candidate) => candidate.loaderId === row.loaderId,
							).length,
							fullIdentity: cached.filter(
								(candidate) =>
									candidate.requestHeadersSha256 === row.requestHeadersSha256 &&
									candidate.documentGeneration === row.documentGeneration,
							).length,
							completeBody: cached.filter(
								(candidate) => candidate.bodyProof?.complete === true,
							).length,
							bodyProofReasons: [
								...new Set(
									cached.map(
										(candidate) => candidate.bodyProof?.reason ?? "not-read",
									),
								),
							].slice(0, 16),
						},
						bodyProofReason: row.bodyProof?.reason ?? null,
						proxyCandidates: {
							selected: selectedPackets.slice(0, 8).map((candidate) => ({
								id: candidate.id,
								...headerProvenance(candidate),
								complete: candidate.complete,
								canceled: candidate.canceled,
								vary: candidate.vary ?? null,
								transportBodyReceipt: candidate.transportBodyReceipt ?? null,
							})),
							selectedTruncated: selectedPackets.length > 8,
							sameUrlMethod: candidates.length,
							fullIdentity: candidates.filter(
								(candidate) =>
									candidate.requestHeadersSha256 === row.requestHeadersSha256 &&
									candidate.documentGeneration === row.documentGeneration,
							).length,
							responseId: candidates.filter(
								(candidate) =>
									row.proxyResponseId && candidate.id === row.proxyResponseId,
							).length,
						},
					};
				}),
			},
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
					bodyReadbackReceipt: row.bodyReadbackReceipt ?? null,
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
		recordMeasuredFailure,
		endScope() {
			closed = true;
			for (const row of rows())
				if (row.stream && !row.stream.finalized) {
					row.stream.finalized = true;
					row.streamReceipt = {
						protocol: "passive-network-copy-v1",
						sourceRevision: browserRevision,
						captureComplete: false,
						byteCoverageExact: false,
						terminal: "scope-ended",
						capturedBytes: row.stream.bytes,
						capturedBodySha256: shaChunks(row.stream.chunks),
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
				missingEvent("duplicateRequest");
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
				observedInMeasurement: measurementStarted && !measurementClosed,
			};
			row.initialHeaderIdentity = headerIdentity(event.request.headers);
			requests.set(event.requestId, row);
			if (extra.has(event.requestId)) {
				applyExtra(row, extra.get(event.requestId));
				extra.delete(event.requestId);
			}
			if (responseExtras.has(event.requestId)) {
				applyResponseExtra(row, responseExtras.get(event.requestId));
				responseExtras.delete(event.requestId);
				joinedResponseExtras++;
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
			principalEpoch.response(event.requestId, event.response.headers);
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("responseBeforeRequest");
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
			row.initialResponseVary = row.vary;
			startStream(row);
		},
		responseExtra(event) {
			principalEpoch.response(event.requestId, event.headers);
			const row = requests.get(event.requestId);
			const metadata = {
				...controlResponseMetadata(event.headers, event.statusCode),
				httpErrorObserved: event.statusCode >= 400,
			};
			if (!row) {
				if (responseExtras.has(event.requestId)) {
					errors++;
					responseExtras.get(event.requestId).httpErrorObserved ||=
						metadata.httpErrorObserved;
				} else if (limited()) overflow++;
				else responseExtras.set(event.requestId, metadata);
				return;
			}
			applyResponseExtra(row, metadata);
		},
		finished(event) {
			const row = requests.get(event.requestId);
			if (!row) {
				missingEvent("finishedBeforeRequest");
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
				missingEvent("failedBeforeRequest");
				return;
			}
			if (captureContextFailures && !measurementClosed && row.observedInMeasurement) recordMeasuredFailure(event.requestId);
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
				missingEvent("dataBeforeRequest");
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
	context,
	transport,
	origin,
	headers,
	contextId,
	browserRevision,
	compiledCachedNavigations,
	captureContextFailures = false,
}) {
	const session = await page.createCDPSession();
	const principalEpoch = createPrincipalEpochObserver(contextId);
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
		captureContextFailures,
		principalEpoch,
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
	await capturePrincipalBoundary({ context, observer: principalEpoch, stage: "start", deadlineMs: performance.now() + 10000 });
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
		async close({ deadlineMs } = {}) {
			try { await capturePrincipalBoundary({ context, observer: principalEpoch, stage: "end", deadlineMs }); }
			finally {
				collector.endScope();
				for (const [method, original] of originals) page[method] = original;
				await session.detach();
			}
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
					row.transportBodyReceipt = { protocol: "proxy-natural-eof-decoded-bytes-v1", naturalEOF: true,
						decodedBytes: bytes.length, bodySha256: sha(bytes) };
					assignBodyProof(row, inspectRequiredFlightBody(bytes, {
						action: row.action,
						cachedNavigations: compiledCachedNavigations,
						requestKind: row.requestKind,
					}), "proxy-natural-eof", row.transportBodyReceipt.bodySha256);
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
