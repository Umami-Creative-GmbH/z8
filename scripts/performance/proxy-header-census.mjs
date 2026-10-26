/** Pure observations of one owned proxy's upstream response headers; no cookie/native eligibility claim. */
import { createHash } from "node:crypto";

export const proxyHeaderCensusProtocol =
	"owned-proxy-upstream-header-census-v1";
export const proxyHeaderCensusLimit = 10000;
export const proxyHeaderSnapshotByteLimit = 65536;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const contextKnown = (value) =>
	typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const requestKnown = (value) =>
	typeof value === "string" && /^[a-f0-9]{32}\.[1-9][0-9]{0,9}$/.test(value);
const faultKinds = ["error", "duplicate", "missing", "late", "overflow"];
const emptyFaultCounts = () =>
	Object.fromEntries(faultKinds.map((kind) => [kind, 0]));
const summarize = (requests, faults, unretainedFaults) => {
	const count = (kind) =>
		faults.filter((fault) => fault.kind === kind).length +
		unretainedFaults[kind];
	return {
		accepted: requests.length,
		knownHeaders: requests.filter((row) => row.observation === "headers")
			.length,
		pending: requests.filter((row) => row.observation === "pending").length,
		unknownHeaders: requests.filter(
			(row) => row.observation === "unknown-headers",
		).length,
		terminalBeforeHeaders: requests.filter(
			(row) => row.observation === "terminal-before-headers",
		).length,
		setCookieResponses: requests.filter((row) => row.setCookieLines > 0).length,
		setCookieLines: requests.reduce(
			(sum, row) => sum + (row.setCookieLines ?? 0),
			0,
		),
		errors: count("error"),
		duplicates: count("duplicate"),
		missing: count("missing"),
		late: count("late"),
		overflow:
			count("overflow") +
			Object.values(unretainedFaults).reduce((sum, value) => sum + value, 0),
	};
};
const inspectHeaders = (headers) => {
	try {
		if (
			!headers ||
			Array.isArray(headers) ||
			![Object.prototype, null].includes(Object.getPrototypeOf(headers))
		)
			return null;
		const keys = Reflect.ownKeys(headers),
			lines = [];
		if (keys.length > proxyHeaderCensusLimit) return null;
		let bytes = 0,
			valueCount = 0;
		for (const key of keys) {
			if (
				typeof key !== "string" ||
				!/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/.test(key)
			)
				return null;
			const descriptor = Object.getOwnPropertyDescriptor(headers, key);
			if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
			const values = descriptor.value;
			if (
				typeof values !== "string" &&
				(!Array.isArray(values) ||
					values.length === 0 ||
					values.length > proxyHeaderCensusLimit)
			)
				return null;
			bytes += Buffer.byteLength(key);
			if (bytes > proxyHeaderSnapshotByteLimit) return null;
			for (
				let index = 0;
				index < (typeof values === "string" ? 1 : values.length);
				index++
			) {
				if (++valueCount > proxyHeaderCensusLimit) return null;
				const item =
					typeof values === "string"
						? { value: values }
						: Object.getOwnPropertyDescriptor(values, String(index));
				if (
					!item ||
					!Object.hasOwn(item, "value") ||
					typeof item.value !== "string"
				)
					return null;
				bytes += Buffer.byteLength(item.value);
				if (bytes > proxyHeaderSnapshotByteLimit) return null;
				if (key.toLowerCase() === "set-cookie") lines.push(item.value);
			}
		}
		return {
			setCookieLines: lines.length,
			setCookieSha256: lines.length ? digest(JSON.stringify(lines)) : null,
		};
	} catch {
		return null;
	}
};
const snapshot = (contextId, closed, requests, faults, unretainedFaults) => {
	const facts = {
		protocol: proxyHeaderCensusProtocol,
		contextId,
		limit: proxyHeaderCensusLimit,
		closed,
		requests: requests
			.map((row) => ({ ...row }))
			.sort((a, b) =>
				a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0,
			),
		faults: faults.map((fault) => ({ ...fault })),
		unretainedFaults: { ...unretainedFaults },
	};
	return {
		...facts,
		counts: summarize(facts.requests, facts.faults, facts.unretainedFaults),
		censusSha256: digest(JSON.stringify(facts)),
	};
};

export function createProxyHeaderCensus({ contextId }) {
	if (!contextKnown(contextId))
		throw Error("A technical context identity is required.");
	const requests = new Map();
	const faults = [];
	const unretainedFaults = emptyFaultCounts();
	let closed = false;
	const fault = (kind, event) => {
		if (faults.length === proxyHeaderCensusLimit) unretainedFaults[kind]++;
		else faults.push({ kind, event });
	};
	const active = (requestId, event) => {
		if (closed) {
			fault("late", event);
			return false;
		}
		if (!requestKnown(requestId)) {
			fault("error", event);
			return false;
		}
		return true;
	};
	const pending = (requestId, event) => {
		if (!active(requestId, event)) return null;
		const row = requests.get(requestId);
		if (!row) {
			fault("missing", event);
			return null;
		}
		if (row.observation !== "pending") {
			fault("duplicate", event);
			return null;
		}
		return row;
	};
	return {
		accepted(requestId) {
			if (!active(requestId, "accepted")) return;
			if (requests.has(requestId)) {
				fault("duplicate", "accepted");
				return;
			}
			if (requests.size === proxyHeaderCensusLimit) {
				fault("overflow", "accepted");
				return;
			}
			requests.set(requestId, {
				requestId,
				observation: "pending",
				setCookieLines: null,
				setCookieSha256: null,
			});
		},
		headers(requestId, headers) {
			const row = pending(requestId, "headers");
			if (!row) return;
			const facts = inspectHeaders(headers);
			Object.assign(
				row,
				facts
					? { observation: "headers", ...facts }
					: {
							observation: "unknown-headers",
							setCookieLines: null,
							setCookieSha256: null,
						},
			);
		},
		terminalBeforeHeaders(requestId, fact) {
			const row = pending(requestId, "terminal-before-headers");
			if (!row) return;
			if (fact?.upstreamClosed !== true || fact.headersReceived !== false) {
				fault("error", "terminal-before-headers");
				return;
			}
			row.observation = "terminal-before-headers";
		},
		observerError() {
			if (closed) fault("late", "observer-error");
			fault("error", "observer-error");
		},
		close() {
			if (closed) fault("duplicate", "close");
			else closed = true;
		},
		snapshot() {
			return snapshot(
				contextId,
				closed,
				[...requests.values()],
				faults,
				unretainedFaults,
			);
		},
	};
}

/** Checks serialized facts, not whether the observation is clean or sufficient for any Native proof. */
export function validateProxyHeaderCensus(proof, { contextId } = {}) {
	try {
		const keys = (value, expected) =>
			value &&
			[Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
			Reflect.ownKeys(value).length === expected.length &&
			expected.every((key) => {
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				return descriptor && Object.hasOwn(descriptor, "value");
			});
		const count = (value) => Number.isSafeInteger(value) && value >= 0;
		if (
			!keys(proof, [
				"protocol",
				"contextId",
				"limit",
				"closed",
				"requests",
				"faults",
				"unretainedFaults",
				"counts",
				"censusSha256",
			]) ||
			!contextKnown(contextId) ||
			proof.contextId !== contextId ||
			proof.protocol !== proxyHeaderCensusProtocol ||
			proof.limit !== proxyHeaderCensusLimit ||
			typeof proof.closed !== "boolean" ||
			!/^[a-f0-9]{64}$/.test(proof.censusSha256) ||
			!Array.isArray(proof.requests) ||
			proof.requests.length > proxyHeaderCensusLimit ||
			!Array.isArray(proof.faults) ||
			proof.faults.length > proxyHeaderCensusLimit ||
			!keys(proof.unretainedFaults, faultKinds) ||
			!Object.values(proof.unretainedFaults).every(count) ||
			(Object.values(proof.unretainedFaults).some((value) => value > 0) &&
				proof.faults.length !== proxyHeaderCensusLimit)
		)
			return false;
		if (
			proof.requests.some(
				(row) =>
					!keys(row, [
						"requestId",
						"observation",
						"setCookieLines",
						"setCookieSha256",
					]) ||
					!requestKnown(row.requestId) ||
					![
						"pending",
						"headers",
						"unknown-headers",
						"terminal-before-headers",
					].includes(row.observation) ||
					(row.observation === "headers"
						? !count(row.setCookieLines) ||
							row.setCookieLines > proxyHeaderCensusLimit ||
							(row.setCookieLines === 0
								? row.setCookieSha256 !== null
								: !/^[a-f0-9]{64}$/.test(row.setCookieSha256))
						: row.setCookieLines !== null || row.setCookieSha256 !== null),
			) ||
			new Set(proof.requests.map((row) => row.requestId)).size !==
				proof.requests.length
		)
			return false;
		const events = {
			error: [
				"accepted",
				"headers",
				"terminal-before-headers",
				"observer-error",
			],
			duplicate: ["accepted", "headers", "terminal-before-headers", "close"],
			missing: ["headers", "terminal-before-headers"],
			late: [
				"accepted",
				"headers",
				"terminal-before-headers",
				"observer-error",
			],
			overflow: ["accepted"],
		};
		if (
			proof.faults.some(
				(fault) =>
					!keys(fault, ["kind", "event"]) ||
					!Object.hasOwn(events, fault.kind) ||
					!events[fault.kind].includes(fault.event) ||
					(!proof.closed && (fault.kind === "late" || fault.event === "close")),
			)
		)
			return false;
		const expected = snapshot(
			contextId,
			proof.closed,
			proof.requests,
			proof.faults,
			proof.unretainedFaults,
		);
		if (
			!keys(proof.counts, Object.keys(expected.counts)) ||
			!Object.values(proof.counts).every(count) ||
			!Object.values(expected.counts).every(count)
		)
			return false;
		return JSON.stringify(proof) === JSON.stringify(expected);
	} catch {
		return false;
	}
}
