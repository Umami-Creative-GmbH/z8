import { readFile } from "node:fs/promises";
export const collectorProtocol = "z8-fixture-otlp-collector-v2";
const nativeProtocol = "z8-fixture-native-observer-v2";
const localEndpoint = (endpoint) => {
	const url = new URL(endpoint);
	if (
		url.protocol !== "http:" ||
		url.hostname !== "127.0.0.1" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error("Fixture observation must remain loopback-only.");
	return url.origin;
};
const post = async (endpoint, path, body, protocol) => {
	const response = await fetch(new URL(path, endpoint), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30000),
	});
	if (!response.ok)
		throw new Error(
			"Fixture observation lifecycle failed; coverage remains incomplete.",
		);
	const result = await response.json();
	if (result.protocol !== protocol)
		throw new Error("Fixture observation protocol mismatch.");
	return result;
};
/** Register every measured, prerequisite and cleanup identity before browser or server IO. */
export async function beginCollectorVisit({ control, traceIds }) {
	const collector = JSON.parse(await readFile(control, "utf8"));
	if (
		collector.kind !== collectorProtocol ||
		typeof collector.observerControl !== "string"
	)
		throw new Error(
			"A v2 collector with independent native observation is required.",
		);
	const observer = JSON.parse(
		await readFile(collector.observerControl, "utf8"),
	);
	if (observer.protocol !== nativeProtocol)
		throw new Error("A v2 native observer is required.");
	const endpoint = localEndpoint(collector.endpoint);
	const observerEndpoint = localEndpoint(observer.endpoint);
	await post(endpoint, "/visits/register", { traceIds }, collectorProtocol);
	await post(
		observerEndpoint,
		"/visits/register",
		{ traceIds },
		nativeProtocol,
	);
	return { endpoint, observerEndpoint, traceIds, protocol: collectorProtocol };
}
/** Native lifecycle counts are independent of export delivery; forceFlush precedes collector reconciliation. */
export async function endCollectorVisit(visit) {
	if (visit.protocol !== collectorProtocol)
		throw new Error("Invalid observation lifecycle.");
	const { proof } = await post(
		visit.observerEndpoint,
		"/visits/close",
		{ traceIds: visit.traceIds },
		nativeProtocol,
	);
	return post(
		visit.endpoint,
		"/visits/close",
		{ traceIds: visit.traceIds, proof },
		collectorProtocol,
	);
}

/** Global wire counts also cover late or unregistered work that never reaches the collector. */
export async function readCollectorCounters(control) {
	const collector = JSON.parse(await readFile(control, "utf8"));
	if (
		collector.kind !== collectorProtocol ||
		typeof collector.observerControl !== "string"
	)
		throw new Error("A v2 collector is required for native counters.");
	const observer = JSON.parse(
		await readFile(collector.observerControl, "utf8"),
	);
	if (observer.protocol !== nativeProtocol)
		throw new Error("A v2 native observer is required.");
	const response = await fetch(
		new URL("/counters", localEndpoint(observer.endpoint)),
		{ signal: AbortSignal.timeout(5000) },
	);
	if (!response.ok) throw new Error("Native counters unavailable.");
	const value = await response.json();
	if (
		value.protocol !== nativeProtocol ||
		value.driverCounter !== true ||
		![
			value.driverQueries,
			value.started?.queries,
			value.ended?.queries,
			value.activeTraces,
		].every((number) => Number.isSafeInteger(number) && number >= 0)
	)
		throw new Error("Native counters are incomplete.");
	return value;
}
export async function reconcileCollectorRun({ control, before, traceIds }) {
	const after = await readCollectorCounters(control);
	const collector = JSON.parse(await readFile(control, "utf8"));
	const response = await fetch(
		new URL("/metrics", localEndpoint(collector.endpoint)),
		{ signal: AbortSignal.timeout(15000) },
	);
	if (!response.ok) throw new Error("Collector evidence unavailable.");
	const ids = new Set(traceIds);
	const evidence = (await response.json()).filter((entry) =>
		ids.has(entry.traceId),
	);
	const result = {
		driverQueryCount: after.driverQueries - before.driverQueries,
		nativeQueryStartedCount: after.started.queries - before.started.queries,
		nativeQueryEndedCount: after.ended.queries - before.ended.queries,
		observedQueryCount: evidence.reduce(
			(sum, entry) => sum + entry.observedQueryCount,
			0,
		),
		pendingNativeQueries: after.started.queries - after.ended.queries,
		activeTraces: after.activeTraces,
		allReceivedTracesReconciled: evidence.every(
			(entry) =>
				entry.coverage?.nativeProof === true &&
				entry.coverage.closed === true &&
				entry.coverage.incomplete === false &&
				entry.coverage.unattributedNativeSpans === 0 &&
				entry.coverage.lateSpans === 0,
		),
		complete: false,
	};
	result.complete =
		before.activeTraces === 0 &&
		before.started.queries === before.ended.queries &&
		[
			result.driverQueryCount,
			result.nativeQueryStartedCount,
			result.nativeQueryEndedCount,
			result.observedQueryCount,
		].every((number) => Number.isSafeInteger(number) && number >= 0) &&
		result.driverQueryCount === result.nativeQueryStartedCount &&
		result.nativeQueryStartedCount === result.nativeQueryEndedCount &&
		result.nativeQueryEndedCount === result.observedQueryCount &&
		result.pendingNativeQueries === 0 &&
		result.activeTraces === 0 &&
		result.allReceivedTracesReconciled;
	return result;
}
