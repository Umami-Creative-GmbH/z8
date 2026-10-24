import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	FixtureNativeCoverage,
	startFixtureNativeControl,
} from "../../apps/webapp/src/lib/performance-fixture-native-coverage.ts";
import { beginMultiInstanceObservation } from "./multi-instance-observation.mjs";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

test("two replica labels cannot reuse one collector or native-control endpoint", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-multi-reused-control-"));
	try {
		const native = join(directory, "native.json");
		await writeFile(
			native,
			JSON.stringify({
				endpoint: "http://127.0.0.1:9",
				protocol: "z8-fixture-native-observer-v2",
			}),
		);
		const controls = {
			a: join(directory, "a.json"),
			b: join(directory, "b.json"),
		};
		for (const path of Object.values(controls))
			await writeFile(
				path,
				JSON.stringify({
					kind: "z8-fixture-otlp-collector-v2",
					endpoint: "http://127.0.0.1:8",
					observerControl: native,
				}),
			);
		await assert.rejects(
			beginMultiInstanceObservation({ controls }),
			/independently/,
		);
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});

test("paired V2 lifecycle adds both replicas' same-trace evidence and detects globally lost work", {
	timeout: 15000,
}, async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-multi-observe-")),
		nodes = {};
	try {
		for (const replica of ["a", "b"]) {
			const control = join(directory, `${replica}-collector.json`),
				native = join(directory, `${replica}-native.json`);
			const child = spawn(
				process.execPath,
				[
					fileURLToPath(new URL("./collector.mjs", import.meta.url)),
					"--control",
					control,
					"--out",
					join(directory, `${replica}-metrics.json`),
					"--require-registration",
					"--observer-control",
					native,
				],
				{ stdio: "ignore", windowsHide: true },
			);
			nodes[replica] = { child };
			let endpoint;
			for (let attempt = 0; attempt < 100; attempt++) {
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
			const spans = [];
			const server = await startFixtureNativeControl(
				coverage,
				async () => {
					const response = await fetch(endpoint, {
						method: "POST",
						headers: { "content-type": "application/json" },
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
											spans: spans.splice(0),
										},
									],
								},
							],
						}),
					});
					assert.equal(response.status, 200);
				},
				native,
			);
			Object.assign(nodes[replica], { server, control, coverage, spans });
		}
		const observation = await beginMultiInstanceObservation({
			controls: { a: nodes.a.control, b: nodes.b.control },
		});
		const traceId = "d".repeat(32),
			visit = await observation.beginVisit([traceId]);
		for (const [replica, count] of [
			["a", 1],
			["b", 2],
		])
			for (let index = 0; index < count; index++) {
				const node = nodes[replica],
					span = {
						name: "pg.query",
						instrumentationScope: { name: "@opentelemetry/instrumentation-pg" },
						spanContext: () => ({ traceId }),
					};
				node.coverage.onStart(span);
				node.coverage.driverQuery(traceId);
				node.coverage.onEnd(span);
				node.spans.push({
					name: "pg.query",
					traceId,
					spanId: String(index + 1).padStart(16, "0"),
					startTimeUnixNano: "1000000",
					endTimeUnixNano: "2000000",
					attributes: [
						{ key: "db.response.returned_rows", value: { intValue: "1" } },
					],
				});
			}
		const closed = await observation.endVisit(visit);
		assert.equal(closed.replicas.a[0].observedQueryCount, 1);
		assert.equal(closed.replicas.b[0].observedQueryCount, 2);
		const proof = await observation.finish();
		assert.equal(proof.complete, true);
		assert.equal(proof.combined.driverQueryCount, 3);
		assert.equal(proof.combined.observedQueryCount, 3);
		// This deliberately never exports; the whole-run oracle must still detect it.
		nodes.b.coverage.driverQuery();
		const invalid = await observation.reconcile();
		assert.equal(invalid.complete, false);
		assert.equal(invalid.replicas.b.driverQueryCount, 3);
	} finally {
		for (const node of Object.values(nodes)) {
			node.server?.closeAllConnections();
			if (node.server) await new Promise((done) => node.server.close(done));
			node.child.kill();
			await new Promise((done) =>
				node.child.exitCode !== null ? done() : node.child.once("exit", done),
			);
		}
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});
