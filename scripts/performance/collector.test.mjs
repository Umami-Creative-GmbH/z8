import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("local OTLP collection counts driver queries once and retains no SQL, parameters or tokens", {
	timeout: 15000,
}, async () => {
	const folder = await mkdtemp(join(tmpdir(), "z8-collector-"));
	const control = join(folder, "control.json");
	const output = join(folder, "backend.json");
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(new URL("./collector.mjs", import.meta.url)),
			"--port",
			"0",
			"--control",
			control,
			"--out",
			output,
		],
		{ stdio: "ignore" },
	);
	try {
		let endpoint;
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				endpoint = JSON.parse(await readFile(control, "utf8")).endpoint;
				break;
			} catch {
				await pause(25);
			}
		}
		assert.ok(endpoint, "Collector must start on its local interface.");
		assert.equal(new URL(endpoint).hostname, "127.0.0.1");
		const traceId = "a".repeat(32);
		const span = (id, name, attributes = []) => ({
			traceId,
			spanId: id.padStart(16, "0"),
			name,
			kind: 3,
			startTimeUnixNano: "1000000",
			endTimeUnixNano: "6000000",
			attributes,
			status: { code: 1 },
		});
		const body = {
			resourceSpans: [
				{
					resource: {
						attributes: [
							{ key: "z8.perf.observer.version", value: { intValue: "1" } },
						],
					},
					scopeSpans: [
						{
							scope: { name: "database" },
							spans: [
								span("1", "db.query", [
									{
										key: "db.statement",
										value: { stringValue: "PRIVATE_SQL_CANARY" },
									},
								]),
							],
						},
						{
							scope: { name: "@opentelemetry/instrumentation-pg" },
							spans: [
								span("2", "pg.query:SELECT private_database", [
									{
										key: "db.response.returned_rows",
										value: { intValue: "3" },
									},
									{
										key: "db.query.parameters",
										value: { stringValue: "PRIVATE_TOKEN_CANARY" },
									},
								]),
								span("3", "pg.query:SELECT transaction", [
									{
										key: "db.response.returned_rows",
										value: { intValue: "2" },
									},
								]),
								span("4", "pg-pool.connect"),
							],
						},
					],
				},
			],
		};
		for (let index = 0; index < 2; index++)
			assert.equal(
				(
					await fetch(endpoint, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					})
				).status,
				200,
			);
		const metricsResponse = await fetch(new URL("/metrics", endpoint));
		const text = await metricsResponse.text();
		const [metric] = JSON.parse(text);
		assert.equal(
			metric.queryCount,
			2,
			"Manual wrapper spans and retry duplicates must not double-count actual driver work.",
		);
		assert.equal(metric.queryDurationMs, 10);
		assert.equal(metric.rowsRetrieved, 5);
		assert.equal(metric.poolWaitMs, 5);
		assert.equal(metric.cacheHits, null);
		assert.equal(metric.cacheMisses, null);
		assert.equal(metric.eventLoopDelayMs, null);
		assert.doesNotMatch(
			text,
			/PRIVATE_|private_database|transaction|db.statement|parameters/,
		);
		assert.doesNotMatch(
			await readFile(output, "utf8"),
			/PRIVATE_|private_database|db.statement|parameters/,
		);
	} finally {
		child.kill();
		await new Promise((done) => {
			if (child.exitCode !== null) done();
			else child.once("exit", done);
		});
		await rm(folder, { recursive: true, force: true });
	}
});
