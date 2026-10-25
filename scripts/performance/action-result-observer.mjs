/** Passive, bounded semantics at the already-owned HTTP forwarding seam. No payload is retained in evidence. */
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export const actionResultPolicy = Object.freeze({
	version: 1,
	scope:
		"named compiled EffectResult actions and explicit Flight server errors; other contracts out of scope",
	contracts: [
		"getWorkHoursAnalyticsData",
		"generateReport",
		"getAccessibleEmployeesAction",
	],
	encodedLimit: 4 * 1024 * 1024,
	decodedLimit: 8 * 1024 * 1024,
	retainedLimit: 32 * 1024 * 1024,
	recordLimit: 10000,
	registryLimit: 512,
});

/** Only the action's root model is inspected; nested domain success/false values are unrelated. */
export function classifyRootActionResult(bytes, knownContract) {
	const records = new Map();
	let offset = 0,
		serverErrors = 0,
		unknown = false;
	try {
		const direct = JSON.parse(bytes.toString());
		if (!knownContract) return { outcome: "out-of-scope", serverErrors: 0 };
		return { outcome: effectOutcome(direct), serverErrors: 0 };
	} catch {}
	while (offset < bytes.length) {
		if ([10, 13].includes(bytes[offset])) {
			offset++;
			continue;
		}
		// Installed React emits unnumbered :H<code><JSON> resource hints, not action results.
		if (
			bytes[offset] === 58 &&
			bytes[offset + 1] === 72 &&
			/[DCLmSXM]/.test(String.fromCharCode(bytes[offset + 2]))
		) {
			let end = bytes.indexOf(10, offset);
			if (end < 0) end = bytes.length;
			try {
				JSON.parse(bytes.subarray(offset + 3, end).toString());
			} catch {
				unknown = true;
				break;
			}
			offset = end + 1;
			continue;
		}
		const colon = bytes.indexOf(58, offset);
		if (
			colon < 0 ||
			!/^[0-9a-f]+$/.test(bytes.subarray(offset, colon).toString()) ||
			records.size >= 4096
		) {
			unknown = true;
			break;
		}
		const id = bytes.subarray(offset, colon).toString();
		if (records.has(id)) {
			unknown = true;
			break;
		}
		const start = colon + 1;
		// Flight raw text has a byte length. Its contents must never be mistaken for protocol records.
		if (bytes[start] === 84) {
			const comma = bytes.indexOf(44, start),
				length = comma < 0 ? "" : bytes.subarray(start + 1, comma).toString();
			if (
				!/^[0-9a-f]+$/.test(length) ||
				comma + 1 + Number.parseInt(length, 16) > bytes.length
			) {
				unknown = true;
				break;
			}
			offset = comma + 1 + Number.parseInt(length, 16);
			records.set(id, { text: true });
			continue;
		}
		let end = bytes.indexOf(10, start);
		if (end < 0) end = bytes.length;
		let text = bytes.subarray(start, end).toString();
		offset = end + 1;
		const tag = /^[A-Z]/.test(text) ? text[0] : null;
		if (tag) text = text.slice(1);
		try {
			const value = JSON.parse(text);
			if (tag === "E") {
				serverErrors++;
				records.set(id, { serverError: true });
			} else if (tag === null) records.set(id, { value });
			else if (["I", "H", "D"].includes(tag))
				records.set(id, { metadata: true });
			else {
				unknown = true;
				break;
			}
		} catch {
			unknown = true;
			break;
		}
	}
	if (serverErrors) return { outcome: "server-error", serverErrors };
	if (!knownContract) return { outcome: "out-of-scope", serverErrors: 0 };
	if (unknown) return { outcome: "unknown", serverErrors: 0 };
	let result = records.get("0")?.value?.a;
	const visited = new Set();
	for (
		let depth = 0;
		typeof result === "string" && /^\$@?[0-9a-f]+$/.test(result) && depth < 8;
		depth++
	) {
		const id = result.replace(/^\$@?/, "");
		if (visited.has(id)) return { outcome: "unknown", serverErrors: 0 };
		visited.add(id);
		result = records.get(id)?.value;
	}
	return { outcome: effectOutcome(result), serverErrors: 0 };
}
function effectOutcome(value) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return "unknown";
	if (value.success === true) return "success";
	return value.success === false && typeof value.error === "string"
		? "application-failure"
		: "unknown";
}
const counters = () => ({
	observed: 0,
	successes: 0,
	failures: 0,
	serverErrors: 0,
	unknown: 0,
	outOfScope: 0,
	httpErrors: 0,
});

export function createActionResultObserver(limits = actionResultPolicy) {
	limits = { ...actionResultPolicy, ...limits };
	for (const key of [
		"encodedLimit",
		"decodedLimit",
		"retainedLimit",
		"recordLimit",
		"registryLimit",
	])
		if (
			!Number.isSafeInteger(limits[key]) ||
			limits[key] <= 0 ||
			limits[key] > actionResultPolicy[key]
		)
			throw Error("Invalid bounded application observer limit.");
	const requests = new Map(),
		registry = new Map(),
		contracts = {},
		byTrace = new Map(),
		totals = counters();
	const semantic = (row) =>
		Boolean(row.actionId || row.malformedAction || row.flight);
	let next = 0,
		retained = 0,
		pending = 0,
		overflows = 0,
		decodeFailures = 0,
		registryConflicts = 0,
		assets = 0;
	const scoped = (traceId) => {
		if (!byTrace.has(traceId)) byTrace.set(traceId, counters());
		return byTrace.get(traceId);
	};
	const add = (row, key, value = 1) => {
		totals[key] += value;
		scoped(row.traceId)[key] += value;
	};
	const discard = (row) => {
		retained -= row.bytes;
		row.chunks = [];
		row.bytes = 0;
		requests.delete(row.id);
	};
	const decode = (row) => {
		const bytes = Buffer.concat(row.chunks),
			options = { maxOutputLength: limits.decodedLimit };
		if (!row.encoding || row.encoding === "identity") {
			if (bytes.length > limits.decodedLimit) throw Error("bounded");
			return bytes;
		}
		if (row.encoding === "gzip") return gunzipSync(bytes, options);
		if (row.encoding === "br") return brotliDecompressSync(bytes, options);
		if (row.encoding === "deflate") return inflateSync(bytes, options);
		throw Error("unknown encoding");
	};
	return {
		request({ traceId, method, headers, applicationOrigin, compiledAsset }) {
			if (++next > limits.recordLimit) {
				overflows++;
				return null;
			}
			const requestedAction =
				applicationOrigin === true &&
				method === "POST" &&
				headers["next-action"] !== undefined;
			const actionId =
				requestedAction &&
				typeof headers["next-action"] === "string" &&
				/^[a-f0-9]{40,128}$/.test(headers["next-action"])
					? headers["next-action"]
					: null;
			const row = {
				id: next,
				traceId,
				applicationOrigin: applicationOrigin === true,
				compiledAsset: compiledAsset === true,
				actionId,
				malformedAction: requestedAction && !actionId,
				bytes: 0,
				chunks: [],
				done: false,
			};
			requests.set(next, row);
			return next;
		},
		response(id, { mimeType, encoding, status }) {
			const row = requests.get(id);
			if (!row) return;
			row.script =
				row.compiledAsset &&
				/^(?:application|text)\/(?:javascript|x-javascript|ecmascript)(?:;|$)/i.test(
					String(mimeType),
				);
			row.flight =
				row.applicationOrigin &&
				/^text\/x-component(?:;|$)/i.test(String(mimeType));
			row.encoding = String(encoding ?? "").toLowerCase();
			row.status = status;
		},
		bytes(id, chunk) {
			const row = requests.get(id);
			if (!row || row.overflow || (!row.script && !semantic(row))) return;
			if (
				row.bytes + chunk.length > limits.encodedLimit ||
				retained + chunk.length > limits.retainedLimit
			) {
				overflows++;
				row.overflow = true;
				retained -= row.bytes;
				row.bytes = 0;
				row.chunks = [];
				return;
			}
			row.chunks.push(chunk);
			row.bytes += chunk.length;
			retained += chunk.length;
		},
		end(id) {
			const row = requests.get(id);
			if (!row || row.done) return;
			row.done = true;
			if (!row.script && !semantic(row)) {
				discard(row);
				return;
			}
			pending++;
			// Forwarding finishes naturally; semantic analysis never holds the response open.
			setImmediate(() => {
				try {
					if (row.overflow) {
						if (semantic(row)) add(row, "unknown");
						return;
					}
					const bytes = decode(row);
					if (row.script) {
						assets++;
						for (const match of bytes
							.toString()
							.matchAll(
								/createServerReference\)\(["']([a-f0-9]{40,128})["'],[^;\n]{0,240}?["']([A-Za-z][A-Za-z0-9_]*)["']\)/g,
							)) {
							if (!actionResultPolicy.contracts.includes(match[2])) continue;
							if (registry.has(match[1]) && registry.get(match[1]) !== match[2])
								registryConflicts++;
							else if (
								!registry.has(match[1]) &&
								registry.size >= limits.registryLimit
							)
								overflows++;
							else registry.set(match[1], match[2]);
						}
						return;
					}
					add(row, "observed");
					const name = registry.get(row.actionId),
						result = row.malformedAction
							? { outcome: "unknown" }
							: classifyRootActionResult(bytes, Boolean(name));
					if (row.status >= 400) add(row, "httpErrors");
					const key = {
						success: "successes",
						"application-failure": "failures",
						"server-error": "serverErrors",
						unknown: "unknown",
						"out-of-scope": "outOfScope",
					}[result.outcome];
					add(row, key);
					if (name) {
						contracts[name] ??= counters();
						contracts[name].observed++;
						contracts[name][key]++;
						if (row.status >= 400) contracts[name].httpErrors++;
					}
				} catch (error) {
					if (
						error?.code === "ERR_BUFFER_TOO_LARGE" ||
						error?.message === "bounded"
					)
						overflows++;
					else decodeFailures++;
					if (semantic(row)) add(row, "unknown");
				} finally {
					pending--;
					discard(row);
				}
			});
		},
		abort(id) {
			const row = requests.get(id);
			if (!row || row.done) return;
			row.done = true;
			if (semantic(row)) add(row, "unknown");
			discard(row);
		},
		snapshot() {
			return {
				policy: actionResultPolicy,
				...totals,
				pending:
					pending +
					[...requests.values()].filter((row) => semantic(row) && !row.done)
						.length,
				overflows,
				decodeFailures,
				registryConflicts,
				observedScriptAssets: assets,
				mappedContracts: [...new Set(registry.values())].sort(),
				contracts: structuredClone(contracts),
				byTrace: [...byTrace].map(([traceId, counts]) => ({
					traceId,
					...counts,
				})),
				complete:
					pending === 0 &&
					![...requests.values()].some((row) => semantic(row) && !row.done) &&
					overflows === 0 &&
					decodeFailures === 0 &&
					registryConflicts === 0 &&
					totals.unknown === 0,
			};
		},
	};
}
