import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test("registered native coverage rejects lost or orphan work and isolates closed historical evidence", {
	timeout: 15000,
}, async () => {
	const folder = await mkdtemp(join(tmpdir(), "z8-collector-lifecycle-"));
	const control = join(folder, "control.json");
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(new URL("./collector.mjs", import.meta.url)),
			"--control",
			control,
			"--out",
			join(folder, "metrics.json"),
			"--require-registration",
		],
		{ stdio: "ignore" },
	);
	try {
		let endpoint;
		for (let index = 0; index < 100; index++) {
			try {
				endpoint = JSON.parse(await readFile(control, "utf8")).endpoint;
				break;
			} catch {
				await pause(20);
			}
		}
		assert.ok(endpoint);
		const post = async (path, body) => {
			const response = await fetch(new URL(path, endpoint), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			assert.equal(response.status, 200);
			return response.json();
		};
		const metric = async (traceId) =>
			(await (await fetch(new URL("/metrics", endpoint))).json()).find(
				(entry) => entry.traceId === traceId,
			);
		const send = async (traceId, spanId = "1") =>
			post("/v1/traces", {
				resourceSpans: [
					{
						resource: {
							attributes: [
								{ key: "z8.perf.observer.version", value: { intValue: "2" } },
							],
						},
						scopeSpans: [
							{
								scope: { name: "@opentelemetry/instrumentation-pg" },
								spans: [
									{
										traceId,
										spanId: spanId.padStart(16, "0"),
										name: "pg.query",
										startTimeUnixNano: "1000000",
										endTimeUnixNano: "2000000",
									},
								],
							},
						],
					},
				],
			});
		const proof = (traceId, queries = 1, complete = true) => ({
			traceId,
			queries,
			driverQueries: queries,
			driverComplete: true,
			acquisitions: 0,
			cache: 0,
			complete,
		});
		const first = "a".repeat(32),
			second = "b".repeat(32),
			third = "c".repeat(32),
			fourth = "d".repeat(32);
		await post("/visits/register", { traceIds: [first] });
		await send(first);
		await send(first);
		assert.equal(
			(await metric(first)).queryCount,
			null,
			"Open windows cannot claim finished native coverage",
		);
		await post("/visits/close", { traceIds: [first], proof: [proof(first)] });
		assert.equal((await metric(first)).queryCount, 1);
		const closedCoverage = (await metric(first)).coverage;
		assert.deepEqual(
			Object.fromEntries(
				[
					"registration",
					"closed",
					"incomplete",
					"unattributedNativeSpans",
					"rejectedBatches",
				].map((key) => [key, closedCoverage[key]]),
			),
			{
				registration: true,
				closed: true,
				incomplete: false,
				unattributedNativeSpans: 0,
				rejectedBatches: 0,
			},
		);
		assert.equal((await metric(first)).coverage.incomplete, false);
		await post("/visits/register", { traceIds: [second] });
		await send(second);
		assert.equal(
			(
				await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "{",
				})
			).status,
			400,
		);
		await post("/visits/close", { traceIds: [second], proof: [proof(second)] });
		assert.equal((await metric(second)).queryCount, null);
		assert.equal((await metric(second)).coverage.rejectedBatches, 1);
		assert.equal(
			(await metric(first)).queryCount,
			1,
			"A later broken batch must not erase closed, reconciled evidence",
		);
		await post("/visits/register", { traceIds: [third] });
		await send(third);
		await post("/visits/close", {
			traceIds: [third],
			proof: [proof(third, 2)],
		});
		assert.equal(
			(await metric(third)).queryCount,
			null,
			"SDK count greater than delivered count proves missing native work",
		);
		await post("/visits/register", { traceIds: [fourth] });
		await send(fourth);
		for (let batch = 0; batch < 1001; batch++)
			await post("/v1/traces", {
				resourceSpans: [
					{
						scopeSpans: [
							{
								scope: { name: "@opentelemetry/instrumentation-pg" },
								spans: Array.from({ length: 1000 }, (_, index) => ({
									traceId: (batch * 1000 + index + 100)
										.toString(16)
										.padStart(32, "0"),
									spanId: "1".padStart(16, "0"),
									name: "pg.query",
								})),
							},
						],
					},
				],
			});
		await post("/visits/close", { traceIds: [fourth], proof: [proof(fourth)] });
		assert.equal((await metric(fourth)).queryCount, null);
		assert.equal(
			(await metric(fourth)).coverage.unattributedNativeSpans,
			1001000,
		);
		const health = await (await fetch(new URL("/health", endpoint))).json();
		assert.equal(health.traces, 4);
		assert.equal(health.activeTraces, 0);
		assert.equal(health.retainedSpanIds, 0);
		await send(first, "2");
		assert.equal(
			(await metric(first)).queryCount,
			null,
			"Late native work invalidates its own closed identity",
		);
	} finally {
		child.kill();
		await new Promise((done) =>
			child.exitCode !== null ? done() : child.once("exit", done),
		);
		await rm(folder, { recursive: true, force: true });
	}
});
