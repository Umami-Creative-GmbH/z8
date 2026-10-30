// @vitest-environment node
/** PREPARED diagnostic regression. Root alone executes this loopback child/server test. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	ROOT_CONTEXT,
	SpanKind,
	TraceFlags,
	trace,
	type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BasicTracerProvider,
	BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { expect, it } from "vitest";
import { SetupPrivacySpanProcessor } from "../../apps/webapp/src/lib/setup/telemetry";
import { isolateFixtureExporter } from "../../apps/webapp/src/lib/performance-fixture-export-scope";
import { FixturePerformanceSpanProcessor } from "../../apps/webapp/src/lib/performance-fixture-observer";
import {
	FixtureNativeCoverage,
	installFixtureDriverCounter,
	startFixtureNativeControl,
} from "../../apps/webapp/src/lib/performance-fixture-native-coverage";
import {
	beginCollectorVisit,
	endCollectorVisit,
	readCollectorCounters,
	reconcileCollectorRun,
} from "./collector-client.mjs";

const collectorFile = fileURLToPath(
	new URL("./collector.mjs", import.meta.url),
);
const clockFile = fileURLToPath(
	new URL("./test-fixtures/collector-owned-clock.mjs", import.meta.url),
);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

type ClockResult = {
	kind: string;
	id: number;
	ok: boolean;
	advanceMs: number;
	actualHousekeepingCallbacks: number;
	totalHousekeepingCallbacks: number;
	realTimerUnrefed: boolean;
};
function advanceOwnedCollector(
	child: ChildProcess,
	advanceMs: number,
): Promise<ClockResult> {
	return new Promise((accept, reject) => {
		const timer = setTimeout(() => {
			dispose();
			reject(Error("Owned test collector clock did not respond."));
		}, 5000);
		const dispose = () => {
			clearTimeout(timer);
			child.off("message", received);
			child.off("exit", exited);
		};
		const exited = () => {
			dispose();
			reject(Error("Owned test collector exited before clock receipt."));
		};
		const received = (value: unknown) => {
			if (
				!value ||
				typeof value !== "object" ||
				!("kind" in value) ||
				value.kind !== "owned-collector-test-clock-result"
			)
				return;
			if (!("id" in value) || value.id !== 1) return;
			dispose();
			if (!("ok" in value) || value.ok !== true) {
				reject(Error("Owned test collector rejected the clock step."));
				return;
			}
			accept(value as ClockResult);
		};
		child.on("message", received);
		child.once("exit", exited);
		child.send(
			{ kind: "owned-collector-test-clock", id: 1, advanceMs },
			(error) => {
				if (error) {
					dispose();
					reject(error);
				}
			},
		);
	});
}
async function stopOwnedCollector(child: ChildProcess) {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null)
		return;
	await new Promise<void>((done, reject) => {
		let forced = false;
		const timer = setTimeout(() => {
			forced = true;
			child.kill("SIGKILL");
		}, 5000);
		const hard = setTimeout(() => {
			clearTimeout(timer);
			reject(Error("Owned test child exit was not observed."));
		}, 7000);
		child.once("exit", () => {
			clearTimeout(timer);
			clearTimeout(hard);
			forced
				? reject(Error("Owned test collector required forced cleanup."))
				: done();
		});
		child.kill("SIGTERM");
		try {
			if (child.connected) child.disconnect();
		} catch {
			/* The owned IPC channel may already have closed. */
		}
	});
}

const cases = [
	{ name: "no aging", advanceMs: 0, first: true, later: true },
	{
		name: "exactly ten quiet minutes",
		advanceMs: 600000,
		first: true,
		later: true,
	},
	{
		name: "one millisecond before the next actual housekeeping tick",
		advanceMs: 659999,
		first: true,
		later: true,
	},
	{
		name: "the first actual housekeeping tick after ten quiet minutes",
		advanceMs: 660000,
		first: true,
		later: true,
	},
	{
		name: "without an earlier batch",
		advanceMs: 660000,
		first: false,
		later: true,
	},
	{
		name: "without a later batch",
		advanceMs: 660000,
		first: true,
		later: false,
	},
	{
		name: "query-only after the first housekeeping tick beyond ten quiet minutes",
		advanceMs: 660000,
		first: true,
		later: true,
		acquisitions: false,
	},
];

it.each(cases)(
	"keeps an OPEN registered SDK/export visit lossless at $name",
	async ({ name, advanceMs, first, later, acquisitions = true }) => {
		const folder = await mkdtemp(
			join(tmpdir(), "z8-collector-open-retention-"),
		);
		const control = join(folder, "collector-private.json"),
			nativeControl = join(folder, "native-private.json");
		const child = spawn(
			process.execPath,
			[
				"--import",
				pathToFileURL(clockFile).href,
				collectorFile,
				"--control",
				control,
				"--out",
				join(folder, "metrics.json"),
				"--require-registration",
				"--observer-control",
				nativeControl,
			],
			{
				stdio: ["ignore", "ignore", "ignore", "ipc"],
				windowsHide: true,
				env: { ...process.env, NODE_OPTIONS: "" },
			},
		);
		let nativeServer: Server | undefined,
			provider: BasicTracerProvider | undefined;
		let spawnFailed = false;
		child.once("error", () => {
			spawnFailed = true;
		});
		try {
			let endpoint: string | undefined;
			for (let attempt = 0; attempt < 100; attempt++) {
				if (spawnFailed || child.exitCode !== null || child.signalCode !== null)
					throw Error("Owned test collector exited during setup.");
				try {
					endpoint = JSON.parse(await readFile(control, "utf8")).endpoint;
					break;
				} catch {
					await pause(20);
				}
			}
			expect(
				endpoint,
				"actual unchanged collector must listen before the SDK test starts",
			).toBeTruthy();
			if (!endpoint) throw Error("Owned test collector unavailable.");
			const coverage = new FixtureNativeCoverage();
			let activeDriverSpan: Span | undefined;
			class TinyDriver {
				query() {
					return "unchanged";
				}
				execute() {
					return "unchanged";
				}
			}
			installFixtureDriverCounter(
				TinyDriver,
				coverage,
				() => activeDriverSpan?.spanContext().traceId,
			);
			const driver = new TinyDriver();
			const exporter = isolateFixtureExporter(
				new OTLPTraceExporter({ url: endpoint }),
			);
			const delegate = new SetupPrivacySpanProcessor(
				new BatchSpanProcessor(exporter, {
					maxQueueSize: 20000,
					maxExportBatchSize: 128,
					scheduledDelayMillis: 500,
					exportTimeoutMillis: 10000,
				}),
			);
			const processor = new FixturePerformanceSpanProcessor(delegate, coverage);
			provider = new BasicTracerProvider({
				resource: resourceFromAttributes({ "z8.perf.observer.version": 2 }),
				spanProcessors: [processor],
			});
			nativeServer = await startFixtureNativeControl(
				coverage,
				() => processor.forceFlush(),
				nativeControl,
			);
			const traceId = randomBytes(16).toString("hex");
			const before = await readCollectorCounters(control);
			const visit = await beginCollectorVisit({ control, traceIds: [traceId] });
			const parent = trace.setSpanContext(ROOT_CONTEXT, {
				traceId,
				spanId: randomBytes(8).toString("hex"),
				traceFlags: TraceFlags.SAMPLED,
				isRemote: true,
			});
			const pg = provider.getTracer("@opentelemetry/instrumentation-pg"),
				emittedSpanIds: string[] = [];
			const emitBatch = async () => {
				if (acquisitions) {
					const acquisition = pg.startSpan(
						"pg-pool.connect",
						{ kind: SpanKind.CLIENT },
						parent,
					);
					emittedSpanIds.push(acquisition.spanContext().spanId);
					acquisition.end();
				}
				const query = pg.startSpan(
					"pg.query.open-retention-test",
					{
						kind: SpanKind.CLIENT,
						attributes: { "db.response.returned_rows": 0 },
					},
					parent,
				);
				expect(query.spanContext().traceId).toBe(traceId);
				emittedSpanIds.push(query.spanContext().spanId);
				activeDriverSpan = query;
				try {
					expect(driver.query()).toBe("unchanged");
				} finally {
					activeDriverSpan = undefined;
					query.end();
				}
				await processor.forceFlush(); // Real SDK delegate + real OTLP HTTP exporter; never a fabricated JSON batch.
			};
			if (first) await emitBatch();
			const firstResponse = await fetch(new URL("/metrics", endpoint));
			expect(firstResponse.status).toBe(200);
			const firstMetrics = await firstResponse.json();
			expect(firstMetrics.length).toBe(first ? 1 : 0);
			if (first) {
				expect(firstMetrics[0].observedQueryCount).toBe(1);
				expect(firstMetrics[0].observedPoolAcquisitions).toBe(
					Number(acquisitions),
				);
			}
			const clock = await advanceOwnedCollector(child, advanceMs);
			expect(clock.realTimerUnrefed).toBe(true);
			expect(clock.actualHousekeepingCallbacks).toBe(
				Math.floor(advanceMs / 60000),
			);
			if (later) await emitBatch();
			const expected = Number(first) + Number(later);
			const expectedAcquisitions = acquisitions ? expected : 0;
			expect(new Set(emittedSpanIds).size).toBe(
				expected + expectedAcquisitions,
			);
			const closed = await endCollectorVisit(visit);
			const native = closed.nativeCloseProof[0],
				observed = closed.traces[0];
			const standard = await reconcileCollectorRun({
				control,
				before,
				traceIds: [traceId],
			});
			console.log(
				JSON.stringify({
					diagnostic: "open-collector-retention",
					name,
					traceSha256: sha(traceId),
					advanceMs,
					actualHousekeepingCallbacks: clock.actualHousekeepingCallbacks,
					expected,
					expectedAcquisitions,
					nativeQueries: native.queries,
					nativeAcquisitions: native.acquisitions,
					nativeDriverQueries: native.driverQueries,
					nativeComplete: native.complete,
					receivedQueries: observed.observedQueryCount,
					receivedAcquisitions: observed.observedPoolAcquisitions,
					collectorClosed: observed.coverage.closed,
					collectorNativeProof: observed.coverage.nativeProof,
					collectorIncomplete: observed.coverage.incomplete,
					standardComplete: standard.complete,
				}),
			);
			expect(native.queries).toBe(expected);
			expect(native.acquisitions).toBe(expectedAcquisitions);
			expect(native.driverQueries).toBe(expected);
			expect(native.complete).toBe(true);
			expect(native.drained).toBe(true);
			// Lossless OPEN visits must reconcile at the real close, regardless of quiet age.
			expect(observed.observedQueryCount).toBe(expected);
			expect(observed.observedPoolAcquisitions).toBe(expectedAcquisitions);
			expect(observed.coverage.closed).toBe(true);
			expect(observed.coverage.nativeProof).toBe(true);
			expect(observed.coverage.incomplete).toBe(false);
			expect(standard.complete).toBe(true);
		} finally {
			try {
				await provider?.shutdown();
			} finally {
				try {
					nativeServer?.closeAllConnections();
					await new Promise<void>((done) =>
						nativeServer ? nativeServer.close(() => done()) : done(),
					);
				} finally {
					try {
						await stopOwnedCollector(child);
					} finally {
						const ownedFolder = await realpath(folder),
							tempRoot = await realpath(tmpdir());
						expect(
							ownedFolder.startsWith(
								join(tempRoot, "z8-collector-open-retention-"),
							),
						).toBe(true);
						await rm(ownedFolder, { recursive: true, force: true });
					}
				}
			}
		}
	},
	25000,
);
