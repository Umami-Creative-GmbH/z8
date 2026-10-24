import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";

test("irrelevant span traces cannot exhaust native visit accounting", {
	timeout: 15000,
}, async () => {
	const folder = await mkdtemp(join(tmpdir(), "z8-collector-capacity-"));
	const control = join(folder, "control.json");
	const child = spawn(
		process.execPath,
		[
			new URL("./collector.mjs", import.meta.url).pathname.replace(
				/^\/(\w:)/,
				"$1",
			),
			"--control",
			control,
			"--out",
			join(folder, "metrics.json"),
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
		const send = async (scope, spans) =>
			fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					resourceSpans: [{ scopeSpans: [{ scope: { name: scope }, spans }] }],
				}),
			});
		for (let batch = 0; batch < 101; batch++) {
			const response = await send(
				"effect",
				Array.from({ length: 1000 }, (_, index) => ({
					traceId: (batch * 1000 + index + 1).toString(16).padStart(32, "0"),
					spanId: "1".padStart(16, "0"),
					name: "unrelated",
				})),
			);
			assert.equal(
				response.status,
				200,
				"Unrelated span identities must not consume the collector's native metric capacity",
			);
		}
		const traceId = "f".repeat(32);
		assert.equal(
			(
				await send("@opentelemetry/instrumentation-pg", [
					{
						traceId,
						spanId: "2".padStart(16, "0"),
						name: "pg.query",
						startTimeUnixNano: "1000000",
						endTimeUnixNano: "2000000",
					},
				])
			).status,
			200,
		);
		const health = await (await fetch(new URL("/health", endpoint))).json();
		assert.equal(health.traces, 1);
		const metrics = await (await fetch(new URL("/metrics", endpoint))).json();
		assert.equal(
			metrics.find((metric) => metric.traceId === traceId).queryCount,
			1,
		);
	} finally {
		child.kill();
		await new Promise((done) =>
			child.exitCode !== null ? done() : child.once("exit", done),
		);
		await rm(folder, { recursive: true, force: true });
	}
});
