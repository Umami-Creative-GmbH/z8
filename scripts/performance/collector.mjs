#!/usr/bin/env node
import { rename, writeFile } from "node:fs/promises";
/** Loopback OTLP/JSON observation. Raw span payloads are discarded; only allowlisted numerical evidence persists. */
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const output = option("--out");
const control = option("--control");
const port = Number(args.includes("--port") ? option("--port") : 0);
const registeredOnly = args.includes("--require-registration");
const observerControl = args.includes("--observer-control")
	? option("--observer-control")
	: null;
const protocol = registeredOnly
	? "z8-fixture-otlp-collector-v2"
	: "z8-fixture-otlp-collector-v1";
if (!output || !control || !Number.isInteger(port) || port < 0 || port > 65535)
	throw new Error(
		"Provide collector --out, --control and a valid local --port.",
	);
const bodyLimit = 8 * 1024 * 1024;
const traces = new Map();
let rejectedBatches = 0;
let driverObserved = false;
const registered = new Map();
let unattributedNativeSpans = 0;
const markActive = (field) => {
	for (const state of registered.values()) if (!state.closed) state[field]++;
};

const id = (value, bytes) => {
	if (typeof value !== "string") return null;
	if (new RegExp(`^[a-f0-9]{${bytes * 2}}$`, "i").test(value))
		return value.toLowerCase();
	if (!/^[a-z0-9+/_=-]+$/i.test(value)) return null;
	const decoded = Buffer.from(value, "base64");
	return decoded.length === bytes ? decoded.toString("hex") : null;
};
const attributes = (list) =>
	new Map(
		(Array.isArray(list) ? list : []).map((entry) => [
			entry.key,
			entry.value?.boolValue ??
				entry.value?.intValue ??
				entry.value?.doubleValue ??
				entry.value?.stringValue,
		]),
	);
const numeric = (value) =>
	Number.isFinite(Number(value)) &&
	value !== undefined &&
	value !== null &&
	Number(value) >= 0
		? Number(value)
		: null;
const milliseconds = (span) => {
	if (
		![span.startTimeUnixNano, span.endTimeUnixNano].every((value) =>
			/^\d{1,25}$/.test(String(value)),
		)
	)
		return null;
	const duration =
		Number(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) /
		1_000_000;
	return Number.isFinite(duration) && duration >= 0 ? duration : null;
};

function accept(payload) {
	if (!Array.isArray(payload.resourceSpans))
		throw new Error("Malformed OTLP envelope");
	for (const resource of payload.resourceSpans)
		for (const scope of resource.scopeSpans ?? [])
			for (const span of scope.spans ?? []) {
				const traceId = id(span.traceId, 16);
				const spanId = id(span.spanId, 8);
				if (!traceId || !spanId) continue;
				const scopeName =
					scope.scope?.name ?? scope.instrumentationLibrary?.name;
				const query =
					scopeName === "@opentelemetry/instrumentation-pg" &&
					span.name?.startsWith("pg.query");
				const acquisition =
					scopeName === "@opentelemetry/instrumentation-pg" &&
					span.name === "pg-pool.connect";
				const cache =
					scopeName === "z8-fixture-cache" && span.name === "fixture.cache.get";
				const server = span.kind === 2 || span.kind === "SPAN_KIND_SERVER";
				if (!query && !acquisition && !cache && !server) continue;
				if (registeredOnly && !registered.has(traceId)) {
					if (query || acquisition || cache) {
						unattributedNativeSpans++;
						markActive("unattributedNativeSpans");
					}
					continue;
				}
				if (registered.get(traceId)?.closed) {
					registered.get(traceId).lateSpans++;
					continue;
				}
				if (!traces.has(traceId)) {
					if (traces.size >= 100000)
						throw new Error("Collector trace capacity exceeded");
					traces.set(traceId, {
						seen: new Set(),
						lastSeen: Date.now(),
						retired: false,
						incomplete: false,
						observer: false,
						queries: 0,
						queryMs: 0,
						rows: 0,
						rowsKnown: true,
						queryErrors: 0,
						acquisitions: 0,
						acquisitionMs: 0,
						acquisitionErrors: 0,
						hits: 0,
						misses: 0,
						cacheKnown: false,
						cacheUnknown: false,
						cacheErrors: 0,
						loopDelay: null,
						loopSamples: 0,
						loopIncomplete: false,
					});
				}
				const metric = traces.get(traceId);
				if (metric.retired) {
					metric.incomplete = true;
					continue;
				}
				metric.lastSeen = Date.now();
				metric.observer ||=
					Number(
						attributes(resource.resource?.attributes).get(
							"z8.perf.observer.version",
						),
					) >= (registeredOnly ? 2 : 1);
				const attr = attributes(span.attributes);
				const duration = milliseconds(span);
				if (metric.seen.has(spanId)) continue;
				if (metric.seen.size >= 100000) {
					metric.incomplete = true;
					continue;
				}
				metric.seen.add(spanId);
				if ((query || acquisition) && duration === null) {
					metric.incomplete = true;
					continue;
				}
				if (query) {
					driverObserved = true;
					metric.queries++;
					metric.queryMs += duration;
					metric.queryErrors += Number(span.status?.code === 2);
					const rows = numeric(attr.get("db.response.returned_rows"));
					if (rows === null) metric.rowsKnown = false;
					else metric.rows += rows;
				} else if (acquisition) {
					metric.acquisitions++;
					metric.acquisitionMs += duration;
					metric.acquisitionErrors += Number(span.status?.code === 2);
				} else if (cache) {
					if (attr.get("z8.perf.cache.hit") === true) metric.hits++;
					else if (attr.get("z8.perf.cache.hit") === false) metric.misses++;
					else metric.cacheErrors++;
				} else if (server) {
					if (attr.get("z8.perf.cache.coverage") === true)
						metric.cacheKnown = true;
					if (attr.get("z8.perf.cache.coverage") === false)
						metric.cacheUnknown = true;
					const probes = numeric(attr.get("z8.perf.event_loop.probes"));
					const delay = numeric(attr.get("z8.perf.event_loop.max_delay_ms"));
					if (attr.get("z8.perf.event_loop.complete") === false)
						metric.loopIncomplete = true;
					if (probes > 0 && delay !== null) {
						metric.loopSamples += probes;
						metric.loopDelay = Math.max(metric.loopDelay ?? 0, delay);
					}
				}
			}
}

function snapshot() {
	return [...traces].map(([traceId, metric]) => {
		const state = registered.get(traceId);
		const complete =
			!metric.incomplete &&
			(registeredOnly
				? state?.closed &&
					state.proofComplete &&
					state.rejectedBatches === 0 &&
					state.unattributedNativeSpans === 0 &&
					state.lateSpans === 0
				: rejectedBatches === 0);
		const pgKnown =
			complete &&
			(metric.queries > 0 ||
				(metric.observer && (driverObserved || state?.proofComplete)));
		const cacheKnown =
			complete &&
			metric.cacheKnown &&
			!metric.cacheUnknown &&
			metric.cacheErrors === 0;
		return {
			traceId,
			queryCount: pgKnown ? metric.queries : null,
			queryDurationMs: pgKnown ? metric.queryMs : null,
			rowsRetrieved: pgKnown && metric.rowsKnown ? metric.rows : null,
			poolWaitMs:
				complete &&
				(metric.acquisitions > 0 || (pgKnown && metric.queries === 0))
					? metric.acquisitionMs
					: null,
			poolWaitDefinition:
				"sum of native pool acquisition durations, including connection setup",
			cacheHits: cacheKnown ? metric.hits : null,
			cacheMisses: cacheKnown ? metric.misses : null,
			cacheDefinition:
				"existing Next 16.4.0 native default use-cache handler get outcomes; excludes private/fetch/React/Redis caches",
			eventLoopDelayMs:
				complete && !metric.loopIncomplete ? metric.loopDelay : null,
			observedQueryErrors: metric.queryErrors,
			observedQueryCount: metric.queries,
			observedPoolAcquisitions: metric.acquisitions,
			observedPoolAcquisitionErrors: metric.acquisitionErrors,
			observedEventLoopProbes: metric.loopSamples,
			coverage: {
				observer: metric.observer,
				pg: pgKnown,
				rows: pgKnown && metric.rowsKnown,
				cache: cacheKnown,
				eventLoop: metric.loopSamples > 0 && !metric.loopIncomplete,
				rejectedBatches: state?.rejectedBatches ?? rejectedBatches,
				...(registeredOnly
					? {
							registration: true,
							closed: state.closed,
							incomplete: !complete,
							unattributedNativeSpans: state.unattributedNativeSpans,
							lateSpans: state.lateSpans,
							nativeProof: state.proofComplete,
							nativeDriverQueries: state.nativeDriverQueries ?? null,
						}
					: {}),
			},
		};
	});
}

let flushes = Promise.resolve();
const flush = () => {
	const text = JSON.stringify(snapshot(), null, 2);
	flushes = flushes.then(async () => {
		const temporary = `${output}.${process.pid}.tmp`;
		await writeFile(temporary, text);
		await rename(temporary, output);
	});
	return flushes.then(() => text);
};
await writeFile(output, "[]", { flag: "wx" });
const server = createServer(async (request, response) => {
	try {
		if (request.method === "GET" && request.url === "/metrics") {
			const text = await flush();
			response.setHeader("Content-Type", "application/json");
			response.end(text);
			return;
		}
		if (request.method === "GET" && request.url === "/health") {
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					kind: protocol,
					traces: traces.size,
					rejectedBatches,
					registeredTraces: registered.size,
					activeTraces: [...registered.values()].filter(
						(state) => !state.closed,
					).length,
					retainedSpanIds: [...traces.values()].reduce(
						(sum, metric) => sum + metric.seen.size,
						0,
					),
					unattributedNativeSpans,
				}),
			);
			return;
		}
		if (
			request.method !== "POST" ||
			!["/v1/traces", "/visits/register", "/visits/close"].includes(request.url)
		) {
			response.writeHead(404);
			response.end();
			return;
		}
		if (!request.headers["content-type"]?.includes("application/json")) {
			response.writeHead(415);
			response.end();
			return;
		}
		const chunks = [];
		let bytes = 0;
		for await (const chunk of request) {
			bytes += chunk.length;
			if (bytes > bodyLimit) throw new Error("OTLP body too large");
			chunks.push(chunk);
		}
		let buffer = Buffer.concat(chunks);
		if (request.headers["content-encoding"] === "gzip")
			buffer = gunzipSync(buffer, { maxOutputLength: bodyLimit });
		else if (
			request.headers["content-encoding"] &&
			request.headers["content-encoding"] !== "identity"
		)
			throw new Error("Unsupported encoding");
		const payload = JSON.parse(buffer.toString("utf8"));
		if (request.url !== "/v1/traces") {
			if (
				!registeredOnly ||
				!Array.isArray(payload.traceIds) ||
				payload.traceIds.length === 0 ||
				payload.traceIds.length > 64 ||
				payload.traceIds.some((value) => id(value, 16) !== value) ||
				new Set(payload.traceIds).size !== payload.traceIds.length
			)
				throw new Error("Invalid registration");
			if (request.url === "/visits/register") {
				if (
					registered.size + payload.traceIds.length > 10000 ||
					[...registered.values()].filter((state) => !state.closed).length +
						payload.traceIds.length >
						64 ||
					payload.traceIds.some((value) => registered.has(value))
				)
					throw new Error("Registration capacity or identity conflict");
				for (const value of payload.traceIds)
					registered.set(value, {
						closed: false,
						proofComplete: false,
						rejectedBatches: 0,
						unattributedNativeSpans: 0,
						lateSpans: 0,
					});
			} else {
				if (
					payload.traceIds.some(
						(value) => !registered.has(value) || registered.get(value).closed,
					)
				)
					throw new Error("Unknown or closed visit");
				for (const value of payload.traceIds) {
					const state = registered.get(value);
					const metric = traces.get(value);
					const proof = payload.proof?.find((entry) => entry.traceId === value);
					state.nativeDriverQueries = Number.isSafeInteger(proof?.driverQueries)
						? proof.driverQueries
						: null;
					state.proofComplete =
						!!metric &&
						proof?.complete === true &&
						["queries", "acquisitions", "cache"].every(
							(key) => Number.isSafeInteger(proof[key]) && proof[key] >= 0,
						) &&
						proof.queries === metric.queries &&
						proof.driverComplete === true &&
						proof.driverQueries === proof.queries &&
						proof.acquisitions === metric.acquisitions &&
						proof.cache === metric.hits + metric.misses + metric.cacheErrors;
					state.closed = true;
					metric?.seen.clear();
				}
			}
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({
					protocol,
					traces:
						request.url === "/visits/close"
							? snapshot().filter((entry) =>
									payload.traceIds.includes(entry.traceId),
								)
							: [],
				}),
			);
			return;
		}
		accept(payload);
		response.setHeader("Content-Type", "application/json");
		response.end("{}");
	} catch {
		if (request.url === "/v1/traces") {
			rejectedBatches++;
			markActive("rejectedBatches");
		}
		response.writeHead(400);
		response.end("Invalid OTLP batch");
	}
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
await new Promise((done) => server.listen(port, "127.0.0.1", done));
const endpoint = `http://127.0.0.1:${server.address().port}/v1/traces`;
await writeFile(
	control,
	JSON.stringify({
		kind: protocol,
		pid: process.pid,
		endpoint,
		...(registeredOnly ? { observerControl } : {}),
	}),
	{ flag: "wx", mode: 0o600 },
);
// Release deduplication IDs after ten quiet minutes. Late data becomes incomplete instead of double-counted.
const housekeeping = setInterval(() => {
	for (const metric of traces.values())
		if (!metric.retired && Date.now() - metric.lastSeen > 600000) {
			metric.seen.clear();
			metric.retired = true;
		}
}, 60000);
housekeeping.unref();
const stop = async () => {
	clearInterval(housekeeping);
	server.close();
	server.closeAllConnections();
	await flush();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
console.log(
	"Local fixture OTLP collector ready; only normalized numerical metrics are retained.",
);
