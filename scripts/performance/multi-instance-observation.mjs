/** Paired native lifecycles. Same trace IDs at two replicas must never be collapsed to one row. */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	beginCollectorVisit,
	collectorProtocol,
	endCollectorVisit,
	readCollectorCounters,
	reconcileCollectorRun,
} from "./collector-client.mjs";
import {
	fixtureBrowserPolicy,
	initializeFixtureBrowserContext,
} from "./fixture-browser.mjs";
import {
	createFixtureTraceTransport,
	fixtureTraceTransport,
} from "./trace-transport.mjs";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const check = (condition, message) => {
	if (!condition) throw new Error(message);
};
export const multiInstanceObservationProtocol = "paired-native-observer-v2";

/** Startup is retained, never subtracted without its exact empty-context proof. */
export function multiInstanceTransportComplete(snapshot) {
	const init = snapshot.browserInitialization,
		after = snapshot.afterInitialization;
	if (
		!Number.isFinite(init?.quietObservedMs) ||
		!Number.isFinite(init?.elapsedMs) ||
		init.elapsedMs < init.quietObservedMs
	)
		return false;
	if (
		!init ||
		!after ||
		init.policy !== fixtureBrowserPolicy ||
		init.launch?.policy !== fixtureBrowserPolicy ||
		init.launch.headless !== true ||
		init.complete !== true ||
		init.capped !== false ||
		init.emptyContext !== true ||
		init.pending !== 0 ||
		init.quietMs !== 2000 ||
		init.capMs !== 10000 ||
		init.quietObservedMs < 2000 ||
		init.elapsedMs >= 10000 ||
		init.requests !== 0 ||
		init.rewrittenRequests !== 0 ||
		init.responseBodyBytes !== 0 ||
		init.upstreamFailures !== 0 ||
		after.refusedRequests !== 0 ||
		after.upstreamFailures !== 0
	)
		return false;
	const keys = [
		"requests",
		"rewrittenRequests",
		"refusedRequests",
		"upstreamFailures",
		"responseBodyBytes",
	];
	for (const key of keys)
		if (
			![snapshot[key], init[key], after[key]].every(
				(value) => Number.isSafeInteger(value) && value >= 0,
			) ||
			snapshot[key] !== init[key] + after[key]
		)
			return false;
	const reasons = [
		"unexpectedLoopback",
		"nonLoopbackHttp",
		"loopbackConnect",
		"nonLoopbackConnect",
		"malformed",
	];
	for (const reason of reasons) {
		const values = [
			snapshot.refusalReasons?.[reason],
			init.refusalReasons?.[reason],
			after.refusalReasons?.[reason],
		];
		if (
			!values.every((value) => Number.isSafeInteger(value) && value >= 0) ||
			values[0] !== values[1] + values[2] ||
			values[2] !== 0 ||
			(reason !== "nonLoopbackConnect" && values[1] !== 0)
		)
			return false;
	}
	return [snapshot, init, after].every(
		(row) =>
			row.refusedRequests ===
			reasons.reduce((sum, key) => sum + row.refusalReasons[key], 0),
	);
}

export async function beginMultiInstanceObservation({
	controls,
	allowedOrigins,
}) {
	check(
		controls?.a && controls?.b && resolve(controls.a) !== resolve(controls.b),
		"Two independent replica collector controls are required.",
	);
	const manifests = await Promise.all(
		["a", "b"].map(async (replica) => {
			const collector = await json(controls[replica]);
			check(
				collector.kind === collectorProtocol && collector.observerControl,
				"Each replica requires a registered V2 collector.",
			);
			const native = await json(collector.observerControl);
			return { collector, native };
		}),
	);
	check(
		manifests[0].collector.endpoint !== manifests[1].collector.endpoint &&
			manifests[0].native.endpoint !== manifests[1].native.endpoint &&
			resolve(manifests[0].collector.observerControl) !==
				resolve(manifests[1].collector.observerControl),
		"Shared collector/native controls cannot prove two replicas independently.",
	);
	let before = Object.fromEntries(
		await Promise.all(
			["a", "b"].map(async (replica) => [
				replica,
				await readCollectorCounters(controls[replica]),
			]),
		),
	);
	for (let attempt = 0; ; attempt++) {
		await new Promise((done) => setTimeout(done, 1000));
		const next = Object.fromEntries(
			await Promise.all(
				["a", "b"].map(async (replica) => [
					replica,
					await readCollectorCounters(controls[replica]),
				]),
			),
		);
		const quiet = ["a", "b"].every(
			(replica) =>
				next[replica].driverQueries === before[replica].driverQueries &&
				next[replica].activeTraces === 0 &&
				next[replica].started.queries === next[replica].ended.queries,
		);
		before = next;
		if (quiet) break;
		check(
			attempt < 9,
			"Replica native counters did not become quiet before the run.",
		);
	}
	for (const row of Object.values(before))
		check(
			row.activeTraces === 0 && row.started.queries === row.ended.queries,
			"Finish previous native activity before starting this run.",
		);
	const allIds = new Set(),
		activeIds = new Set(),
		activeVisits = new Set();
	const visits = [],
		transports = [];
	async function beginVisit(traceIds) {
		check(
			traceIds.length > 0 && traceIds.every((id) => !allIds.has(id)),
			"Trace identities cannot be reused.",
		);
		const pair = {};
		try {
			for (const replica of ["a", "b"])
				pair[replica] = await beginCollectorVisit({
					control: controls[replica],
					traceIds,
				});
		} catch (error) {
			await Promise.allSettled(Object.values(pair).map(endCollectorVisit));
			throw error;
		}
		for (const id of traceIds) {
			allIds.add(id);
			activeIds.add(id);
		}
		const visit = { traceIds, pair };
		activeVisits.add(visit);
		return visit;
	}
	async function endVisit(visit) {
		check(activeVisits.has(visit), "Close each paired visit exactly once.");
		try {
			const settled = await Promise.allSettled(
				["a", "b"].map(async (replica) => [
					replica,
					await endCollectorVisit(visit.pair[replica]),
				]),
			);
			check(
				settled.every((row) => row.status === "fulfilled"),
				"Both native closures must finish; coverage remains incomplete.",
			);
			const closures = Object.fromEntries(settled.map((row) => row.value));
			const replicas = Object.fromEntries(
				Object.entries(closures).map(([replica, row]) => [replica, row.traces]),
			);
			const nativeClose = Object.fromEntries(
				Object.entries(closures).map(([replica, row]) => [
					replica,
					{
						proof: row.nativeCloseProof,
						elapsedMs: row.nativeCloseElapsedMs,
					},
				]),
			);
			const result = { traceIds: visit.traceIds, replicas, nativeClose };
			visits.push(result);
			for (const rows of Object.values(replicas))
				for (const row of rows)
					check(
						row.coverage.nativeProof === true &&
							row.coverage.closed === true &&
							row.coverage.incomplete === false &&
							row.coverage.unattributedNativeSpans === 0 &&
							row.coverage.lateSpans === 0,
						"Paired native visit failed independent count reconciliation.",
					);
			return result;
		} finally {
			for (const id of visit.traceIds) activeIds.delete(id);
			activeVisits.delete(visit);
		}
	}
	function metrics(closed, traceId, { allowCacheError = false } = {}) {
		const rows = Object.values(closed.replicas).flatMap((list) =>
			list.filter((row) => row.traceId === traceId),
		);
		check(rows.length > 0, "No actual replica served the measured trace.");
		for (const row of rows)
			check(
				["observer", "pg", "rows", "eventLoop"].every(
					(key) => row.coverage[key] === true,
				) &&
					(row.coverage.cache === true || allowCacheError) &&
					row.coverage.rejectedBatches === 0 &&
					Number.isFinite(row.poolWaitMs),
				"Native measurements are incomplete.",
			);
		const sum = (key) =>
			rows.some((row) => row[key] === null)
				? null
				: rows.reduce((total, row) => total + row[key], 0);
		return {
			traceId,
			queries: sum("queryCount"),
			rows: sum("rowsRetrieved"),
			hits: sum("cacheHits"),
			misses: sum("cacheMisses"),
			queryDurationMs: sum("queryDurationMs"),
			poolAcquisitionMs: sum("poolWaitMs"),
			eventLoopDelayMs: Math.max(...rows.map((row) => row.eventLoopDelayMs)),
			coverage: {
				observer: true,
				pg: true,
				rows: true,
				cache: rows.every((row) => row.coverage.cache),
				eventLoop: true,
				nativeProof: true,
				closed: true,
				rejectedBatches: 0,
			},
			replicas: closed.replicas,
		};
	}
	async function createContext(browser, origin) {
		const traceIds = Array.from({ length: 3 }, () =>
			randomBytes(16).toString("hex"),
		);
		const visit = await beginVisit(traceIds);
		let current = traceIds[0],
			context,
			transport,
			initialized;
		try {
			transport = await createFixtureTraceTransport({
				origin,
				allowedOrigins: allowedOrigins ?? [origin],
				getTraceId: ({ headers }) => {
					const requested = /^00-([a-f0-9]{32})-[a-f0-9]{16}-0[01]$/i.exec(
						headers.traceparent ?? "",
					)?.[1];
					return requested && activeIds.has(requested) ? requested : current;
				},
			});
			context = await browser.createBrowserContext(
				transport.browserContextOptions,
			);
			initialized = await initializeFixtureBrowserContext({
				context,
				transport,
			});
		} catch (error) {
			await context?.close().catch(() => {});
			await transport?.close();
			if (transport)
				transports.push({
					protocol: fixtureTraceTransport,
					...transport.snapshot(),
				});
			await endVisit(visit);
			throw error;
		}
		let closed = false;
		return {
			context,
			page: initialized.page,
			browserInitialization: initialized.browserInitialization,
			traceIds,
			transport,
			background: () => {
				current = traceIds[2];
			},
			async close() {
				if (closed) return;
				closed = true;
				try {
					await context.close();
					await endVisit(visit);
				} finally {
					try {
						await transport.close();
					} finally {
						transports.push({
							protocol: fixtureTraceTransport,
							...transport.snapshot(),
						});
					}
				}
			},
		};
	}
	async function reconcile() {
		const replicas = Object.fromEntries(
			await Promise.all(
				["a", "b"].map(async (replica) => [
					replica,
					await reconcileCollectorRun({
						control: controls[replica],
						before: before[replica],
						traceIds: [...allIds],
					}),
				]),
			),
		);
		const fields = [
			"driverQueryCount",
			"nativeQueryStartedCount",
			"nativeQueryEndedCount",
			"observedQueryCount",
			"pendingNativeQueries",
			"activeTraces",
		];
		const combined = Object.fromEntries(
			fields.map((key) => [key, replicas.a[key] + replicas.b[key]]),
		);
		return {
			protocol: multiInstanceObservationProtocol,
			replicas,
			combined,
			traces: allIds.size,
			visits: visits.length,
			nativeVisitClosures: visits.map(({ traceIds, nativeClose }) => ({
				traceIds,
				nativeClose,
			})),
			transport: fixtureTraceTransport,
			transports,
			transportComplete: transports.every(multiInstanceTransportComplete),
			complete:
				activeVisits.size === 0 &&
				replicas.a.complete &&
				replicas.b.complete &&
				transports.every(multiInstanceTransportComplete),
		};
	}
	return {
		beginVisit,
		endVisit,
		metrics,
		createContext,
		closeRemainingVisits: () =>
			Promise.allSettled([...activeVisits].map(endVisit)),
		reconcile,
		async finish() {
			check(
				activeVisits.size === 0,
				"Close every context and paired visit before whole-run proof.",
			);
			return reconcile();
		},
	};
}
