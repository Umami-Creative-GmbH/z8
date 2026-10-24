/** Counts encoded HTTP response bodies, including workers, without retaining URLs, headers or payloads. */
export const proxyWireProtocol = "context-proxy-wire-v1";
export const proxyWireByteUnits =
	"http-response-body-bytes-before-content-decoding-excludes-headers";
const names = [
	"javascript",
	"document",
	"rsc",
	"otherFinite",
	"prefetch",
	"longLived",
];
const excluded = (group) => ["prefetch", "longLived"].includes(group);
const groups = () =>
	Object.fromEntries(
		names.map((name) => [
			name,
			{
				requests: 0,
				completed: 0,
				pending: 0,
				errors: 0,
				completedBytes: 0,
				observedBodyBytes: 0,
				inheritedRequests: 0,
				inheritedCompletedBytes: 0,
			},
		]),
	);
function requestGroup(headers = {}) {
	const allowed = [
		"next-router-prefetch",
		"purpose",
		"sec-purpose",
		"accept",
		"upgrade",
		"sec-fetch-dest",
		"rsc",
	];
	const h = Object.fromEntries(
		Object.entries(headers)
			.filter(([key]) => allowed.includes(key.toLowerCase()))
			.map(([key, value]) => [key.toLowerCase(), String(value).toLowerCase()]),
	);
	if (
		h["next-router-prefetch"] === "1" ||
		/prefetch/.test(h.purpose ?? "") ||
		/prefetch/.test(h["sec-purpose"] ?? "")
	)
		return "prefetch";
	if (/text\/event-stream/.test(h.accept ?? "") || h.upgrade === "websocket")
		return "longLived";
	if (
		["script", "worker", "serviceworker", "sharedworker"].includes(
			h["sec-fetch-dest"],
		)
	)
		return "javascript";
	if (["document", "iframe"].includes(h["sec-fetch-dest"])) return "document";
	if (h.rsc === "1") return "rsc";
	return "otherFinite";
}
export function createProxyWireObserver() {
	const requests = new Map();
	let sequence = 0,
		started,
		readyAt,
		lastActivity = 0,
		overflows = 0,
		unknownInheritedRedirects = 0;
	const activity = (record, at) => {
		if (!excluded(record.group)) lastActivity = Math.max(lastActivity, at);
	};
	return {
		request({ traceId, headers }, at) {
			const id = ++sequence;
			if (requests.size >= 10000) {
				overflows++;
				lastActivity = Math.max(lastActivity, at);
				return id;
			}
			const record = {
				traceId,
				group: requestGroup(headers),
				done: false,
				error: false,
				bytes: 0,
				inherited: started === undefined,
			};
			requests.set(id, record);
			activity(record, at);
			return id;
		},
		response(id, { mimeType, status, redirect }, at) {
			const record = requests.get(id);
			if (!record) return;
			const mime = String(mimeType ?? "")
				.split(";", 1)[0]
				.trim()
				.toLowerCase();
			if (record.group !== "prefetch") {
				if (mime === "text/event-stream") record.group = "longLived";
				else if (!excluded(record.group)) {
					if (
						/^(?:application|text)\/(?:javascript|x-javascript|ecmascript)$/.test(
							mime,
						)
					)
						record.group = "javascript";
					else if (mime === "text/x-component") record.group = "rsc";
					else if (mime === "text/html" || mime === "application/xhtml+xml")
						record.group = "document";
				}
			}
			if (status >= 400) record.error = true;
			// A redirect that crosses measurement start cannot be causally joined from HTTP alone.
			// Keep that rare boundary unknown rather than charging inherited bytes as fresh work.
			if (started !== undefined && record.inherited && redirect)
				unknownInheritedRedirects++;
			activity(record, at);
		},
		bytes(id, length, at) {
			const record = requests.get(id);
			if (!record) return;
			if (!Number.isSafeInteger(length) || length < 0) record.error = true;
			else record.bytes += length;
			activity(record, at);
		},
		end(id, { error = false } = {}, at) {
			const record = requests.get(id);
			if (!record || record.done) return;
			record.done = true;
			record.error ||= error;
			activity(record, at);
		},
		begin(at) {
			for (const [id, record] of requests) if (record.done) requests.delete(id);
			started = at;
			readyAt = undefined;
			lastActivity = at;
			unknownInheritedRedirects = 0;
		},
		ready(at) {
			readyAt = at;
			lastActivity = Math.max(lastActivity, at);
		},
		state(at) {
			const total = groups(),
				byTrace = new Map();
			for (const record of requests.values()) {
				if (!byTrace.has(record.traceId)) byTrace.set(record.traceId, groups());
				for (const bucket of [
					total[record.group],
					byTrace.get(record.traceId)[record.group],
				]) {
					bucket.requests++;
					bucket.completed += Number(record.done);
					bucket.pending += Number(!record.done);
					bucket.errors += Number(record.error);
					bucket.observedBodyBytes += record.bytes;
					if (record.inherited) {
						bucket.inheritedRequests++;
						if (record.done) bucket.inheritedCompletedBytes += record.bytes;
					} else if (record.done) bucket.completedBytes += record.bytes;
				}
			}
			const finite = names
				.filter((name) => !excluded(name))
				.map((name) => total[name]);
			const mandatoryPending = finite.reduce(
					(sum, group) => sum + group.pending,
					0,
				),
				mandatoryErrors = finite.reduce(
					(sum, group) => sum + group.errors,
					overflows + unknownInheritedRedirects,
				);
			const complete =
				readyAt !== undefined &&
				mandatoryPending === 0 &&
				mandatoryErrors === 0 &&
				lastActivity + 1000 <= readyAt + 10000 &&
				at - lastActivity >= 1000;
			return {
				protocol: proxyWireProtocol,
				byteUnits: proxyWireByteUnits,
				complete,
				censored: !complete,
				capped: readyAt !== undefined && at - readyAt >= 10000 && !complete,
				mandatoryPending,
				mandatoryErrors,
				quietObservedMs: at - lastActivity,
				postReadyMs: readyAt === undefined ? null : at - readyAt,
				observationOverflows: overflows,
				unknownInheritedRedirects,
				groups: total,
				bytes: Object.fromEntries(
					names
						.filter((name) => !excluded(name))
						.map((name) => [name, total[name].completedBytes]),
				),
				byTrace: [...byTrace].map(([traceId, traceGroups]) => ({
					traceId,
					groups: traceGroups,
				})),
			};
		},
	};
}
