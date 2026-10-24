import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
	FixtureNativeCoverage,
	startFixtureNativeControl,
} from "../../apps/webapp/src/lib/performance-fixture-native-coverage.ts";
import {
	beginCollectorVisit,
	collectorProtocol,
	endCollectorVisit,
} from "./collector-client.mjs";

test("shared visit client drains native control and reconciles the real collector protocol", {
	timeout: 10000,
}, async () => {
	const folder = await mkdtemp(join(tmpdir(), "z8-collector-client-"));
	const control = join(folder, "collector-private.json"),
		nativeControl = join(folder, "native-private.json");
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(new URL("./collector.mjs", import.meta.url)),
			"--control",
			control,
			"--out",
			join(folder, "metrics.json"),
			"--require-registration",
			"--observer-control",
			nativeControl,
		],
		{ stdio: "ignore" },
	);
	let server;
	try {
		let endpoint;
		for (let i = 0; i < 100; i++) {
			try {
				endpoint = JSON.parse(await readFile(control, "utf8")).endpoint;
				break;
			} catch {
				await pause(20);
			}
		}
		assert.ok(endpoint);
		const coverage = new FixtureNativeCoverage();
		coverage.enableDriverCounter();
		const traceId = "a".repeat(32);
		let flushes = 0;
		server = await startFixtureNativeControl(
			coverage,
			async () => {
				flushes++;
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						resourceSpans: [
							{
								resource: {
									attributes: [
										{
											key: "z8.perf.observer.version",
											value: { intValue: "2" },
										},
									],
								},
								scopeSpans: [
									{
										scope: { name: "@opentelemetry/instrumentation-pg" },
										spans: [
											{
												traceId,
												spanId: "1".padStart(16, "0"),
												name: "pg.query",
												startTimeUnixNano: "1000000",
												endTimeUnixNano: "2000000",
											},
										],
									},
								],
							},
						],
					}),
				});
				assert.equal(response.status, 200);
			},
			nativeControl,
		);
		const visit = await beginCollectorVisit({ control, traceIds: [traceId] });
		const span = {
			name: "pg.query",
			instrumentationScope: { name: "@opentelemetry/instrumentation-pg" },
			spanContext: () => ({ traceId }),
		};
		coverage.onStart(span);
		coverage.driverQuery(traceId);
		coverage.onEnd(span);
		const closed = await endCollectorVisit(visit);
		assert.equal(flushes, 1);
		assert.equal(closed.protocol, collectorProtocol);
		assert.equal(closed.traces[0].queryCount, 1);
		assert.equal(closed.traces[0].coverage.nativeProof, true);
		assert.equal(closed.traces[0].coverage.nativeDriverQueries, 1);
		assert.equal(closed.traces[0].coverage.incomplete, false);
		assert.equal(coverage.snapshot().activeTraces, 0);
	} finally {
		server?.closeAllConnections();
		await new Promise((done) => (server ? server.close(done) : done()));
		child.kill();
		await new Promise((done) =>
			child.exitCode !== null ? done() : child.once("exit", done),
		);
		await rm(folder, { recursive: true, force: true });
	}
});
