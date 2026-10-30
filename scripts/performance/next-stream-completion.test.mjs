import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { FixtureNativeCoverage } from "../../apps/webapp/src/lib/performance-fixture-native-coverage.ts";

const require = createRequire(
	new URL("../../apps/webapp/package.json", import.meta.url),
);
const { NodeSDK } = require("@opentelemetry/sdk-node");
const pipePath = require.resolve("next/dist/server/pipe-readable");
const nextRequire = createRequire(pipePath);
let api;
try {
	api = nextRequire("@opentelemetry/api");
} catch {
	api = nextRequire("next/dist/compiled/@opentelemetry/api");
}
const { trace, SpanKind, TraceFlags } = api;
const { getTracer } = nextRequire("./lib/trace/tracer");

async function settlesWithin(promise, ms) {
	let timer;
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => true,
			),
			new Promise((done) => {
				timer = setTimeout(() => done(false), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function installedPipes() {
	// Node cannot resolve Next's extensionless ESM imports. Only adapt resolution:
	// the installed ESM function body and its installed dependencies are unchanged.
	const esm = await readFile(
		require.resolve("next/dist/esm/server/pipe-readable.js"),
		"utf8",
	);
	const resolved = esm.replace(
		/from (['"])(\.[^'"]+)\1/g,
		(_match, _quote, name) =>
			`from ${JSON.stringify(pathToFileURL(nextRequire.resolve(name)).href)}`,
	);
	return [
		["CommonJS", require(pipePath).pipeToNodeResponse],
		[
			"ESM",
			(
				await import(
					`data:text/javascript;base64,${Buffer.from(resolved).toString("base64")}`
				)
			).pipeToNodeResponse,
		],
	];
}

test("Next completes its real SDK request span after disconnect without skipping final work or stream cancellation", async () => {
	const coverage = new FixtureNativeCoverage();
	const sdk = new NodeSDK({
		autoDetectResources: false,
		spanProcessors: [
			{
				onStart: (span) => coverage.onStart(span),
				onEnd: (span) => coverage.onEnd(span),
				forceFlush: async () => {},
				shutdown: async () => {},
			},
		],
	});
	sdk.start();
	const results = [];
	let identity = 0;
	try {
		for (const [format, pipe] of await installedPipes())
			for (const mode of [
				"complete",
				"active-stream-abort",
				"close-wait-abort",
			]) {
				const traceId = String(++identity).repeat(32);
				coverage.register([traceId]);
				let release,
					entered,
					serverResponse,
					pipePromise,
					sourceCanceled = false,
					sourceCompleted = false,
					writes = 0;
				const enteredClose = new Promise((done) => {
					entered = done;
				});
				class CloseLatch extends Promise {
					// biome-ignore lint/suspicious/noThenProperty: Observe Next's actual await boundary with an intentional Promise subclass.
					then(resolve, reject) {
						entered();
						return super.then(resolve, reject);
					}
				}
				const waitUntil = new CloseLatch((done) => {
					release = done;
				});
				const server = createServer((_incoming, response) => {
					serverResponse = response;
					const stream = new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("first"));
							writes++;
							if (mode !== "active-stream-abort") {
								sourceCompleted = true;
								controller.close();
							}
						},
						cancel() {
							sourceCanceled = true;
						},
					});
					const parentSpan = trace.wrapSpanContext({
						traceId,
						spanId: "f".repeat(16),
						traceFlags: TraceFlags.SAMPLED,
						isRemote: true,
					});
					pipePromise = getTracer().trace(
						"BaseServer.handleRequest",
						{ spanName: "GET", kind: SpanKind.SERVER, parentSpan },
						() =>
							pipe(
								stream,
								response,
								mode === "active-stream-abort" ? undefined : waitUntil,
							),
					);
					pipePromise.catch(() => {});
				});
				await new Promise((done) => server.listen(0, "127.0.0.1", done));
				let response, call;
				try {
					await new Promise((done, reject) => {
						call = request(
							`http://127.0.0.1:${server.address().port}/stream-test`,
							(answer) => {
								response = answer;
								answer.on("error", () => {});
								answer.once("data", done);
							},
						);
						call.on("error", reject);
						call.end();
					});
					if (mode !== "active-stream-abort")
						assert.equal(
							await settlesWithin(enteredClose, 500),
							true,
							`${format}: writer.close must enter waitUntil`,
						);
					if (mode !== "complete") {
						const closed = once(serverResponse, "close");
						response.destroy();
						await closed;
					}
					if (mode !== "active-stream-abort")
						assert.equal(
							await settlesWithin(pipePromise, 50),
							false,
							`${format}: waitUntil work remains awaited`,
						);
					release();
					const settled = await settlesWithin(pipePromise, 500),
						proof = coverage.close([traceId])[0];
					results.push({
						format,
						mode,
						settled,
						sourceCanceled,
						sourceCompleted,
						writes,
						serverStarted: proof.serverStarted,
						serverEnded: proof.serverEnded,
						serverBalance: proof.serverBalance,
						complete: proof.complete,
					});
				} finally {
					release();
					response?.destroy();
					call?.destroy();
					server.closeAllConnections();
					await new Promise((done) => server.close(done));
				}
			}
		assert.equal(results.length, 6);
		for (const row of results) {
			const label = `${row.format}/${row.mode}`;
			assert.equal(
				row.settled,
				true,
				`${label}: closed response must not strand the pipe`,
			);
			assert.equal(
				row.serverStarted,
				1,
				`${label}: actual SDK SERVER observed`,
			);
			assert.equal(
				row.serverEnded,
				1,
				`${label}: actual Next tracer ends naturally`,
			);
			assert.equal(row.serverBalance, 0, label);
			assert.equal(row.complete, true, label);
			assert.equal(row.writes, 1, label);
			assert.equal(
				row.sourceCanceled,
				row.mode === "active-stream-abort",
				label,
			);
		}
	} finally {
		await sdk.shutdown();
		trace.disable();
	}
});
