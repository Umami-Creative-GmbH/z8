/** Finite semantic windows and whole-run proof; no telemetry awaits in the reader loop. */
import { randomBytes } from "node:crypto";
import {
	beginCollectorVisit,
	endCollectorVisit,
	readCollectorCounters,
	reconcileCollectorRun,
} from "./collector-client.mjs";
import { fixtureTransportIsComplete } from "./fixture-browser.mjs";

export function createMixedTracePlan(
	next = () => randomBytes(16).toString("hex"),
) {
	const preparation = Array.from({ length: 4 }, next);
	const commands = Array.from({ length: 20 }, () => [next(), next()]);
	const analytics = Array.from({ length: 4 }, () =>
		Array.from({ length: 3 }, next),
	);
	const ids = [...preparation, ...commands.flat(), ...analytics.flat()];
	if (
		ids.length > 64 ||
		ids.length > 10000 ||
		new Set(ids).size !== ids.length ||
		ids.some((value) => !/^[a-f0-9]{32}$/.test(value))
	)
		throw Error("Invalid or overflowing mixed trace identity plan");
	const pairIndex = (pair) => {
		if (!Number.isInteger(pair) || pair < 1 || pair > 20)
			throw Error("Invalid mixed semantic window");
		return pair - 1;
	};
	return {
		ids,
		preparation,
		clock: (pair, action) => {
			if (!["in", "out"].includes(action))
				throw Error("Invalid mixed command identity");
			return commands[pairIndex(pair)][action === "in" ? 0 : 1];
		},
		analytics: (pair, reader) => {
			if (!Number.isInteger(reader) || reader < 0 || reader > 2)
				throw Error("Invalid mixed reader identity");
			return analytics[Math.floor(pairIndex(pair) / 5)][reader];
		},
		groups: analytics.map((traceIds, index) => ({
			firstPair: index * 5 + 1,
			lastPair: index * 5 + 5,
			traceIds,
		})),
	};
}
export async function runMixedReader({ limit, stopped, read, observe }) {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
		throw Error("Invalid mixed reader bound");
	let count = 0;
	while (count < limit && !stopped()) {
		let value;
		try {
			value = await read();
		} catch {
			value = { success: false, censored: true };
		}
		count++;
		observe(value);
		if (!value.success) return { count, failed: true, boundReached: false };
	}
	return { count, failed: false, boundReached: count === limit && !stopped() };
}
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const number = (value) => Number.isFinite(value) && value >= 0;
export function clockObservationIsComplete(value) {
	return (
		value?.success === true &&
		value.censored === false &&
		value.unknownCommandOutcome === false &&
		value.httpStatus === 200 &&
		number(value.commandResponseMs) &&
		number(value.clockReadyMs) &&
		value.clockReadyMs >= value.commandResponseMs
	);
}
export function nativeIsQuiescent(value) {
	return (
		value?.driverCounter === true &&
		integer(value.driverQueries) &&
		integer(value.unknown) &&
		value.activeTraces === 0 &&
		["queries", "acquisitions", "cache"].every(
			(key) =>
				integer(value.started?.[key]) &&
				value.started[key] === value.ended?.[key],
		)
	);
}
export function reconcileMixedNative({ before, after, rows, ids }) {
	const proof = {
		complete: false,
		expectedTraces: ids.length,
		receivedTraces: rows.length,
		driverQueries: null,
		sdkQueries: null,
		receivedQueries: null,
		acquisitions: null,
		cache: null,
		unknownNativeDelta: null,
		incoming: null,
	};
	if (
		!nativeIsQuiescent(before) ||
		!nativeIsQuiescent(after) ||
		new Set(ids).size !== ids.length ||
		new Set(rows.map((row) => row.traceId)).size !== rows.length ||
		rows.length !== ids.length ||
		rows.some((row) => !ids.includes(row.traceId))
	)
		return proof;
	const countFields = [
		"queryCount",
		"observedQueryCount",
		"rowsRetrieved",
		"cacheHits",
		"cacheMisses",
		"observedPoolAcquisitions",
		"observedQueryErrors",
		"observedPoolAcquisitionErrors",
	];
	const metrics = [
		"queryCount",
		"observedQueryCount",
		"queryDurationMs",
		"rowsRetrieved",
		"poolWaitMs",
		"eventLoopDelayMs",
		"cacheHits",
		"cacheMisses",
		"observedPoolAcquisitions",
		"observedQueryErrors",
		"observedPoolAcquisitionErrors",
	];
	if (
		rows.some(
			(row) =>
				countFields.some((key) => !integer(row[key])) ||
				metrics.some((key) => !number(row[key])) ||
				[
					"observer",
					"pg",
					"rows",
					"cache",
					"eventLoop",
					"registration",
					"closed",
					"nativeProof",
				].some((key) => row.coverage?.[key] !== true) ||
				row.coverage.incomplete !== false ||
				["rejectedBatches", "unattributedNativeSpans", "lateSpans"].some(
					(key) => row.coverage[key] !== 0,
				) ||
				row.coverage.nativeDriverQueries !== row.observedQueryCount ||
				row.queryCount !== row.observedQueryCount ||
				row.observedQueryErrors !== 0 ||
				row.observedPoolAcquisitionErrors !== 0,
		)
	)
		return proof;
	const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
	proof.driverQueries = after.driverQueries - before.driverQueries;
	proof.sdkQueries = after.ended.queries - before.ended.queries;
	proof.receivedQueries = sum("observedQueryCount");
	proof.acquisitions = after.ended.acquisitions - before.ended.acquisitions;
	proof.cache = after.ended.cache - before.ended.cache;
	proof.unknownNativeDelta = after.unknown - before.unknown;
	const incomingKeys = [
		"knownHeaderKnownSpan",
		"knownHeaderOtherSpan",
		"otherHeaderKnownSpan",
		"otherHeaderOtherSpan",
		"matchingParent",
		"mismatchingParent",
	];
	if (
		incomingKeys.some(
			(key) =>
				!integer(before.incoming?.[key]) || !integer(after.incoming?.[key]),
		)
	)
		return proof;
	proof.incoming = Object.fromEntries(
		incomingKeys.map((key) => [
			key,
			after.incoming[key] - before.incoming[key],
		]),
	);
	proof.complete =
		[
			proof.driverQueries,
			proof.sdkQueries,
			proof.receivedQueries,
			proof.acquisitions,
			proof.cache,
		].every(integer) &&
		proof.driverQueries === proof.sdkQueries &&
		proof.sdkQueries === proof.receivedQueries &&
		proof.acquisitions === sum("observedPoolAcquisitions") &&
		proof.cache === sum("cacheHits") + sum("cacheMisses") &&
		proof.unknownNativeDelta === 0 &&
		Object.values(proof.incoming).every(integer) &&
		["knownHeaderOtherSpan", "otherHeaderKnownSpan", "mismatchingParent"].every(
			(key) => proof.incoming[key] === 0,
		);
	// The same Node process instruments its observer-control HTTP listener too.
	// Unregistered HTTP alone is diagnostic; unknown PG/cache/acquisition work
	// remains a failure through native totals, driver equality and each trace's proof.
	return proof;
}
export async function beginMixedObservation(control, ids) {
	const before = await readCollectorCounters(control);
	if (!nativeIsQuiescent(before))
		throw Error("Mixed run requires an isolated quiescent native epoch");
	const visit = await beginCollectorVisit({ control, traceIds: ids });
	return { control, ids, before, visit };
}
/** Call only after all browser contexts have closed; one drain for the whole condition. */
export async function finishMixedObservation(observation) {
	const closed = await endCollectorVisit(observation.visit);
	const after = await readCollectorCounters(observation.control);
	const rows = closed.traces ?? [];
	const standard = await reconcileCollectorRun({
		control: observation.control,
		before: observation.before,
		traceIds: observation.ids,
	});
	const proof = reconcileMixedNative({ ...observation, after, rows });
	return {
		nativeCloseProof: closed.nativeCloseProof,
		nativeCloseElapsedMs: closed.nativeCloseElapsedMs,
		nativeRunCoverage: {
			...proof,
			complete: proof.complete && standard.complete,
			standard,
			registration: {
				began: true,
				closed: true,
				traceCount: observation.ids.length,
				protocol: observation.visit.protocol,
			},
			before: nativeCounterSummary(observation.before),
			after: nativeCounterSummary(after),
		},
		rows,
	};
}
function nativeCounterSummary(value) {
	const counts = (bucket) =>
		Object.fromEntries(
			["queries", "acquisitions", "cache"].map((key) => [
				key,
				value[bucket]?.[key] ?? null,
			]),
		);
	return {
		driverCounter: value.driverCounter,
		driverQueries: value.driverQueries,
		activeTraces: value.activeTraces,
		unknown: value.unknown,
		started: counts("started"),
		ended: counts("ended"),
		incoming: Object.fromEntries(
			[
				"knownHeaderKnownSpan",
				"knownHeaderOtherSpan",
				"otherHeaderKnownSpan",
				"otherHeaderOtherSpan",
				"matchingParent",
				"mismatchingParent",
			].map((key) => [key, value.incoming?.[key] ?? null]),
		),
	};
}
export async function settleMixedTransports(
	opened,
	{
		now = () => performance.now(),
		pause = (ms) => new Promise((done) => setTimeout(done, ms)),
	} = {},
) {
	const started = now();
	for (const item of opened) item.transport.wire.ready(started);
	let states;
	do {
		states = opened.map((item) => item.transport.wire.state(now()));
		if (states.every((state) => state.complete || state.capped)) break;
		await pause(50);
	} while (now() - started < 11000);
	return states;
}
export function mixedTransportIsComplete({ traceTransport, wire }) {
	return (
		fixtureTransportIsComplete(traceTransport) &&
		wire?.complete === true &&
		wire.capped === false &&
		wire.mandatoryErrors === 0 &&
		wire.mandatoryPending === 0 &&
		wire.observationOverflows === 0 &&
		wire.unknownInheritedRedirects === 0 &&
		wire.censored === false
	);
}
